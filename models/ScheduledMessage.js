const mongoose = require('mongoose');

const ScheduledMessageSchema = new mongoose.Schema({
  channel: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  scheduledFor: { type: Date, required: true },
  isProcessed: { type: Boolean, default: false },
  parentMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  createdAt: { type: Date, default: Date.now }
});

// Performance index for polling worker
ScheduledMessageSchema.index({ isProcessed: 1, scheduledFor: 1 });

module.exports = mongoose.model('ScheduledMessage', ScheduledMessageSchema);
