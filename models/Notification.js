const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // System if null
  type: { 
    type: String, 
    enum: ['like', 'comment', 'follow', 'login', 'mention', 'system', 'sync_request'],
    required: true 
  },
  content: { type: String }, // e.g. "Liked your broadcast" or "New login from Windows"
  metadata: {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
    deviceName: { type: String },
    location: { type: String }
  },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', NotificationSchema);
