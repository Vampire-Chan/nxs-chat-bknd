require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const Message = require('./models/Message');
const Channel = require('./models/Channel');
const Realm = require('./models/Realm');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);

// HELP DIAGNOSE RENDER FAILURES
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 [CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('💥 [CRITICAL] Uncaught Exception:', err);
  process.exit(1);
});

// Logger Middleware
app.use((req, res, next) => {
  console.log(`📡 [${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// Middleware
const allowedOrigins = [
  process.env.CLIENT_URL,
  'https://nxs-chat-web.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true })); // Keep higher for file uploads

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit auth attempts
  standardHeaders: true,
  legacyHeaders: false,
});

// Health Check
app.get('/api/health', (req, res) => res.json({ status: 'VANI_ONLINE', timestamp: new Date() }));

// Routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/dms', apiLimiter, require('./routes/dms'));
app.use('/api/users', apiLimiter, require('./routes/users'));
app.use('/api/realms', apiLimiter, require('./routes/realms'));
app.use('/api/channels', apiLimiter, require('./routes/channels'));
app.use('/api/posts', apiLimiter, require('./routes/posts'));
app.use('/api/media', apiLimiter, require('./routes/media')); // Consider a separate limit for uploads
app.use('/api/search', apiLimiter, require('./routes/search'));
app.use('/api/admin', apiLimiter, require('./routes/admin'));
app.use('/api/payments', apiLimiter, require('./routes/payments'));

// Database
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const jwt = require('jsonwebtoken');

// Socket.IO
const io = new Server(server, {
  cors: corsOptions
});

app.set('socketio', io);

// Authentication Middleware for Socket.IO
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  if (!token) return next(new Error("Authentication error"));
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).lean();

    if (!user || user.isDisabled) {
      return next(new Error("Authentication error"));
    }

    socket.user = { ...decoded, ...user };
    next();
  } catch (err) {
    next(new Error("Authentication error"));
  }
});

// Track Online Users & Voice Rooms
const onlineUsers = new Map(); 
const voiceRooms = {}; // { roomID: [{ socketId, user }, ...] }
const lastMessageTimestamp = new Map(); // Rate limiting map for sockets

io.on('connection', (socket) => {
  const userId = (socket.user.id || socket.user._id)?.toString();
  
  if (userId) {
    console.log(`⚡ Authenticated user connected: ${userId} (${socket.id})`);
    socket.join(userId);
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    io.emit('user_status_change', { userId, status: 'online' });

    // Update inactivity anchor
    User.findByIdAndUpdate(userId, { lastSeenAt: new Date() }).catch(() => {});
  }

  // --- WEBRTC SIGNALING ---
  socket.on('join_voice', async ({ roomID }) => {
    try {
      const channel = await Channel.findById(roomID);
      if (!channel) return;

      // AUTH CHECK: Must be member of channel/realm
      const userId = socket.user._id.toString();
      if (channel.type === 'dm' || channel.type === 'group_dm') {
        if (!channel.members.some(m => m.toString() === userId)) return;
      } else {
        const realm = await Realm.findById(channel.realm);
        if (!realm || !realm.members.some(m => m.toString() === userId)) return;
      }

      socket.join(`voice:${roomID}`);
      if (!voiceRooms[roomID]) voiceRooms[roomID] = [];
      
      const userPayload = { 
        socketId: socket.id, 
        user: { 
          id: userId, 
          username: socket.user.username, 
          avatar: socket.user.avatar,
          gender: socket.user.gender,
          showGender: socket.user.showGender
        } 
      };
      
      voiceRooms[roomID].push(userPayload);
      const otherUsers = voiceRooms[roomID].filter(u => u.socketId !== socket.id);
      socket.emit('all_users', otherUsers);
      console.log(`🎙️ User ${socket.user.username} joined voice room ${roomID}`);
    } catch (e) { console.error("join_voice error:", e); }
  });

  socket.on('sending_signal', (payload) => {
    // SECURE: Override sender info with authenticated socket user
    const securePayload = {
      signal: payload.signal,
      callerID: socket.id,
      user: { 
        id: socket.user._id, 
        username: socket.user.username, 
        avatar: socket.user.avatar,
        gender: socket.user.gender,
        showGender: socket.user.showGender
      }
    };
    io.to(payload.userToSignal).emit('user_joined', securePayload);
  });

  socket.on('returning_signal', (payload) => {
    io.to(payload.callerID).emit('receiving_returned_signal', { signal: payload.signal, id: socket.id });
  });

  socket.on('leave_voice', ({ channelId }) => {
    if (voiceRooms[channelId]) {
      voiceRooms[channelId] = voiceRooms[channelId].filter(u => u.socketId !== socket.id);
      if (voiceRooms[channelId].length === 0) delete voiceRooms[channelId];
    }
    socket.leave(`voice:${channelId}`);
    io.to(`voice:${channelId}`).emit('user_left_voice', socket.id);
  });

  // --- STANDARD CHAT LOGIC ---
  socket.on('join_channel', (channelId) => {
    socket.join(channelId);
  });

  socket.on('leave_channel', (channelId) => {
    socket.leave(channelId);
  });

  socket.on('send_message', async (data) => {
    // Socket Rate Limiting: Max 3 messages per second
    const now = Date.now();
    const lastMsg = lastMessageTimestamp.get(userId) || 0;
    if (now - lastMsg < 333) {
      return socket.emit('rate_limit_exceeded', { message: "Transmissions too frequent. Stabilize pulse." });
    }
    lastMessageTimestamp.set(userId, now);

    console.log(`💬 Message from ${userId} for channel ${data.channelId}`);
    try {
      const channel = await Channel.findById(data.channelId);
      if (!channel) return;

      // Basic security: Ensure sender is part of the channel/DM
      if (channel.type === 'dm' || channel.type === 'group_dm') {
        if (!channel.members.some(m => m.toString() === userId)) return;
      } else {
        const realm = await Realm.findById(channel.realm);
        if (!realm || !realm.members.some(m => m.toString() === userId)) return;
      }

      const newMessage = new Message({
        channel: data.channelId,
        sender: userId, // SECURE: Use authenticated ID
        content: data.content,
        parentMessage: data.parentMessageId || null
      });
      await newMessage.save();

      // Populate sender info and parent message for the client
      const populatedMessage = await Message.findById(newMessage._id)
        .populate('sender', 'username avatar badges tier isAdmin')
        .populate({
          path: 'parentMessage',
          populate: { path: 'sender', select: 'username avatar' }
        });

      // UPDATE CHANNEL TIMESTAMP
      channel.lastMessageAt = new Date();
      await channel.save();

      // NOTIFY RECIPIENTS
      const recipients = channel.members.filter(m => m.toString() !== userId);
      const Notification = require('./models/Notification');
      
      for (const recipientId of recipients) {
        const notif = new Notification({
          recipient: recipientId,
          sender: userId,
          type: 'mention',
          content: channel.type === 'dm' ? 'transmitted a new signal to you.' : `transmitted a signal in #${channel.name}`,
          metadata: { channelId: channel._id }
        });
        await notif.save();
        
        const populatedNotif = await Notification.findById(notif._id).populate('sender', 'username avatar');
        
        io.to(recipientId.toString()).emit('new_notification', populatedNotif);
        io.to(recipientId.toString()).emit('identity_sync_update');
      }

      io.to(data.channelId).emit('receive_message', populatedMessage);
    } catch (err) {
      console.error("Socket send_message error:", err);
    }
  });

  const pendingCalls = {}; // { channelId: { callerId, recipients: [userId] } }

  socket.on('initiate_call', async (data) => {
    const { channelId, type, senderId, senderName, senderAvatar } = data;
    console.log(`📞 Call Init: ${type} from ${senderId} in ${channelId}`);
    
    try {
      const channel = await Channel.findById(channelId);
      if (!channel) return;

      const recipients = channel.members.filter(m => m.toString() !== senderId);
      pendingCalls[channelId] = { callerId: senderId, recipients: recipients.map(r => r.toString()) };

      const payload = {
        channelId,
        type,
        sender: { id: senderId, username: senderName, avatar: senderAvatar },
        timestamp: Date.now()
      };
      
      recipients.forEach(recipientId => {
        io.to(recipientId.toString()).emit('incoming_call', payload);
      });

      // Also notify the caller that the call has been initiated and is ringing for others.
      io.to(senderId).emit('call_initiated', { channelId, recipients });

    } catch (err) {
      console.error("Socket initiate_call error:", err);
    }
  });

  socket.on('accept_call', ({ channelId }) => {
    const call = pendingCalls[channelId];
    if (call) {
      // Notify the original caller that someone has accepted
      io.to(call.callerId).emit('caller_ready', { channelId });
      
      // Clean up the pending call
      delete pendingCalls[channelId];
    }
  });

  socket.on('react_message', async ({ messageId, emoji, userId, channelId }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return;
      
      if (!msg.reactions) msg.reactions = {};
      
      const currentReactions = msg.reactions[emoji] || [];
      const index = currentReactions.indexOf(userId);
      
      if (index === -1) currentReactions.push(userId);
      else currentReactions.splice(index, 1);
      
      msg.reactions[emoji] = currentReactions;
      msg.markModified('reactions'); // Tell Mongoose the object changed
      await msg.save();
      
      io.to(channelId).emit('message_reaction_update', { messageId, reactions: msg.reactions });
    } catch (err) { console.error(err); }
  });

  socket.on('disconnect', () => {
    // --- VOICE ROOM CLEANUP ---
    for (const roomID in voiceRooms) {
      const index = voiceRooms[roomID].findIndex(u => u.socketId === socket.id);
      if (index !== -1) {
        voiceRooms[roomID].splice(index, 1);
        if (voiceRooms[roomID].length === 0) delete voiceRooms[roomID];
        io.to(`voice:${roomID}`).emit('user_left_voice', socket.id);
        console.log(`📡 Cleaned up voice room ${roomID} for disconnected socket ${socket.id}`);
      }
    }

    if (userId && onlineUsers.has(userId)) {
      const userSockets = onlineUsers.get(userId);
      userSockets.delete(socket.id);
      
      if (userSockets.size === 0) {
        onlineUsers.delete(userId);
        // Broadcast "User Offline"
        io.emit('user_status_change', { userId, status: 'offline' });
      }
    }
  });
});

// USE RENDER'S PORT OR FALLBACK
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Node established on port ${PORT}`);
  
  // Start the 6-hour Resonance Worker (The Dreamer)
  const { startResonanceWorker } = require('./utils/resonanceWorker');
  startResonanceWorker();

  // START SCHEDULED MESSAGE WORKER (Every 1 minute)
  const ScheduledMessage = require('./models/ScheduledMessage');
  const Message = require('./models/Message');
  const Channel = require('./models/Channel');
  const Notification = require('./models/Notification');

  setInterval(async () => {
    try {
      const now = new Date();
      const pending = await ScheduledMessage.find({ 
        scheduledFor: { $lte: now }, 
        isProcessed: false 
      });

      for (const item of pending) {
        // CONVERT TO REAL MESSAGE
        const newMessage = new Message({
          channel: item.channel,
          sender: item.sender,
          content: item.content,
          parentMessage: item.parentMessage,
          timestamp: item.scheduledFor
        });
        await newMessage.save();

        const channel = await Channel.findById(item.channel);
        if (channel) {
          channel.lastMessageAt = now;
          await channel.save();

          // POPULATE & BROADCAST
          const populated = await Message.findById(newMessage._id).populate('sender', 'username avatar badges tier isAdmin');
          io.to(item.channel.toString()).emit('receive_message', populated);

          // NOTIFY RECIPIENTS
          const recipients = channel.members.filter(m => m.toString() !== item.sender.toString());
          for (const recipientId of recipients) {
            const notif = new Notification({
              recipient: recipientId,
              sender: item.sender,
              type: 'mention',
              content: channel.type === 'dm' ? 'transmitted a scheduled signal to you.' : `transmitted a scheduled signal in #${channel.name}`,
              metadata: { channelId: channel._id }
            });
            await notif.save();
            const populatedNotif = await Notification.findById(notif._id).populate('sender', 'username avatar');
            io.to(recipientId.toString()).emit('new_notification', populatedNotif);
            io.to(recipientId.toString()).emit('identity_sync_update');
          }
        }

        item.isProcessed = true;
        await item.save();
        console.log(`⏰ Dispatched scheduled message: ${item._id}`);
      }
    } catch (e) { console.error("Scheduled Message Worker Error:", e); }
  }, 60000);
});
