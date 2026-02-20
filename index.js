require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');
const Message = require('./models/Message');
const Channel = require('./models/Channel');
const Realm = require('./models/Realm');

const app = express();
const server = http.createServer(app);

// Logger Middleware
app.use((req, res, next) => {
  console.log(`📡 [${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health Check
app.get('/api/health', (req, res) => res.json({ status: 'VANI_ONLINE', timestamp: new Date() }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dms', require('./routes/dms'));
app.use('/api/users', require('./routes/users'));
app.use('/api/realms', require('./routes/realms'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/media', require('./routes/media'));
app.use('/api/search', require('./routes/search'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/payments', require('./routes/payments'));

// Database
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const jwt = require('jsonwebtoken');

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.set('socketio', io);

// Authentication Middleware for Socket.IO
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  if (!token) return next(new Error("Authentication error"));
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error("Authentication error"));
  }
});

// Track Online Users & Voice Rooms
const onlineUsers = new Map(); 
const voiceRooms = {}; // { roomID: [{ socketId, user }, ...] }

io.on('connection', (socket) => {
  const userId = (socket.user.id || socket.user._id)?.toString();
  
  if (userId) {
    console.log(`⚡ Authenticated user connected: ${userId} (${socket.id})`);
    socket.join(userId);
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    io.emit('user_status_change', { userId, status: 'online' });
  }

  // --- WEBRTC SIGNALING ---
  socket.on('join_voice', ({ roomID, user }) => {
    const userData = { socketId: socket.id, user };
    if (voiceRooms[roomID]) {
      // IDEMPOTENCY CHECK: Don't add same socket twice
      if (voiceRooms[roomID].some(u => u.socketId === socket.id)) return;

      if (voiceRooms[roomID].length >= 12) { // Increased for server capacity
        socket.emit('room_full');
        return;
      }
      voiceRooms[roomID].push(userData);
    } else {
      voiceRooms[roomID] = [userData];
    }
    
    socket.join(`voice:${roomID}`);
    const otherUsers = voiceRooms[roomID].filter(u => u.socketId !== socket.id);
    socket.emit('all_users', otherUsers);
  });

  socket.on('sending_signal', payload => {
    // payload: { userToSignal (socketId), callerID (socketId), signal, user (callerProfile) }
    io.to(payload.userToSignal).emit('user_joined', { 
      signal: payload.signal, 
      callerID: payload.callerID,
      user: payload.user 
    });
  });

  socket.on('returning_signal', payload => {
    // payload: { signal, callerID (initiatorSocketId) }
    io.to(payload.callerID).emit('receiving_returned_signal', { 
      signal: payload.signal, 
      id: socket.id 
    });
  });

  socket.on('leave_voice', ({ channelId }) => {
    if (voiceRooms[channelId]) {
      voiceRooms[channelId] = voiceRooms[channelId].filter(u => u.socketId !== socket.id);
      if (voiceRooms[channelId].length === 0) delete voiceRooms[channelId];
    }
    socket.leave(`voice:${channelId}`);
    socket.to(`voice:${channelId}`).emit('user_left_voice', socket.id);
  });

  socket.on('reject_call', ({ channelId, senderId }) => {
    // senderId here is actually the User ID of the caller
    io.to(senderId).emit('call_rejected', { channelId });
  });

  // --- STANDARD CHAT LOGIC ---
  socket.on('join_channel', (channelId) => {
    socket.join(channelId);
  });

  socket.on('leave_channel', (channelId) => {
    socket.leave(channelId);
  });

  socket.on('send_message', async (data) => {
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

  socket.on('initiate_call', async (data) => {
    const { channelId, type, senderId, senderName, senderAvatar } = data;
    console.log(`📞 Call Init: ${type} from ${senderId} in ${channelId}`);
    
    try {
      const channel = await Channel.findById(channelId);
      if (!channel) return;

      const recipients = channel.members.filter(m => m.toString() !== senderId);
      const Notification = require('./models/Notification');

      for (const recipientId of recipients) {
        // Emit real-time popup event
        io.to(recipientId.toString()).emit('incoming_call', {
          channelId,
          type,
          sender: { id: senderId, username: senderName, avatar: senderAvatar }
        });

        // Also create a persistent system notification for history/offline visibility
        await new Notification({
          recipient: recipientId,
          sender: senderId,
          type: 'system',
          content: `initiated a ${type} call with you.`,
          metadata: { channelId }
        }).save();
        
        io.to(recipientId.toString()).emit('identity_sync_update');
      }
    } catch (err) {
      console.error("Socket initiate_call error:", err);
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
