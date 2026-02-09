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
app.get('/api/health', (req, res) => res.json({ status: 'NEXUS_ONLINE', timestamp: new Date() }));

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
const voiceRooms = {}; // { roomID: [socketID, ...] }

io.on('connection', (socket) => {
  const userId = socket.user.id || socket.user._id;
  
  if (userId) {
    console.log(`⚡ Authenticated user connected: ${userId} (${socket.id})`);
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    io.emit('user_status_change', { userId, status: 'online' });
  }

  // --- WEBRTC SIGNALING ---
  socket.on('join_voice', (roomID) => {
    if (voiceRooms[roomID]) {
      const length = voiceRooms[roomID].length;
      if (length === 4) {
        socket.emit('room_full');
        return;
      }
      voiceRooms[roomID].push(socket.id);
    } else {
      voiceRooms[roomID] = [socket.id];
    }
    
    // Get other users in this room
    const otherUsers = voiceRooms[roomID].filter(id => id !== socket.id);
    socket.emit('all_users', otherUsers);
  });

  socket.on('sending_signal', payload => {
    io.to(payload.userToSignal).emit('user_joined', { signal: payload.signal, callerID: payload.callerID });
  });

  socket.on('returning_signal', payload => {
    io.to(payload.callerID).emit('receiving_returned_signal', { signal: payload.signal, id: socket.id });
  });

  socket.on('leave_voice', ({ channelId }) => {
    if (voiceRooms[channelId]) {
      voiceRooms[channelId] = voiceRooms[channelId].filter(id => id !== socket.id);
    }
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
        content: data.content
      });
      await newMessage.save();

      // Populate sender info for the client
      const populatedMessage = await Message.findById(newMessage._id).populate('sender', 'username avatar badges tier isAdmin');

      // UPDATE CHANNEL TIMESTAMP
      channel.lastMessageAt = new Date();
      await channel.save();

      io.to(data.channelId).emit('receive_message', {
        _id: populatedMessage._id,
        content: populatedMessage.content,
        timestamp: populatedMessage.timestamp,
        sender: populatedMessage.sender
      });
    } catch (err) {
      console.error("Socket send_message error:", err);
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
  
      socket.on('disconnect', () => {    if (userId && onlineUsers.has(userId)) {
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
