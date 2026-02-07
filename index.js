require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');
const Message = require('./models/Message');

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
app.use('/api/realms', require('./routes/realms'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/users', require('./routes/users'));
app.use('/api/dms', require('./routes/dms'));
app.use('/api/search', require('./routes/search'));
app.use('/api/admin', require('./routes/admin')); // Added // Added

// Database
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Track Online Users & Voice Rooms
const onlineUsers = new Map(); 
const voiceRooms = {}; // { roomID: [socketID, ...] }

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;
  
  if (userId) {
    console.log(`⚡ User connected: ${userId} (${socket.id})`);
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
    try {
      const channel = await require('./models/Channel').findById(data.channelId);
      if (!channel) return;

      // Basic security: Ensure sender is part of the channel/DM
      if (channel.type === 'dm') {
        if (!channel.members.includes(data.senderId)) return;
      } else {
        const realm = await require('./models/Realm').findById(channel.realm);
        if (!realm || !realm.members.includes(data.senderId)) return;
      }

      const newMessage = new Message({
        channel: data.channelId,
        sender: data.senderId,
        content: data.content
      });
      await newMessage.save();

      io.to(data.channelId).emit('receive_message', {
        _id: newMessage._id,
        content: newMessage.content,
        timestamp: newMessage.timestamp,
        sender: data.senderUserObject
      });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('new_post_created', (data) => {
    io.to(data.channelId).emit('receive_post', data.post);
  });

  socket.on('disconnect', () => {
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
