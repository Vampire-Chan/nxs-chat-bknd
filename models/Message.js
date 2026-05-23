const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  channel: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String },
  mediaUrl: { type: String },
  mediaType: { type: String, enum: ['image', 'video', 'file', 'audio'] },
  isEncrypted: { type: Boolean, default: false },
  iv: { type: String },
  
  // REPLY PROTOCOL
  parentMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },

  // EDIT TRACKING
  editedAt: { type: Date, default: null },

  // NEURAL REACTIONS: { ':matrix:': [userId1, userId2] }
  reactions: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({})
  },
  
  timestamp: { type: Date, default: Date.now }
});

// Performance indexes
MessageSchema.index({ channel: 1, timestamp: -1 });
MessageSchema.index({ sender: 1 });

module.exports = mongoose.model('Message', MessageSchema);
