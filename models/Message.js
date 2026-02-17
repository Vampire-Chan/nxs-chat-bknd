const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  channel: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String },
  mediaUrl: { type: String },
  mediaType: { type: String, enum: ['image', 'video', 'file', 'audio'] },
  
  // REPLY PROTOCOL
  parentMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },

  // NEURAL REACTIONS: { ':matrix:': [userId1, userId2] }
  reactions: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({})
  },
  
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);
