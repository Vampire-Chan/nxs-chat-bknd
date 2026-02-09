const mongoose = require('mongoose');

const ChannelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['text', 'voice', 'feed', 'reels', 'announcement', 'dm', 'group_dm'], default: 'text' },
  realm: { type: mongoose.Schema.Types.ObjectId, ref: 'Realm' },
  
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  maxMembers: { type: Number, default: 50 },
  icon: { type: String, default: "" },
  nicknames: { type: mongoose.Schema.Types.Mixed, default: {} }, // { userId: "Nickname" }

  // UNREAD TRACKING
  lastMessageAt: { type: Date, default: Date.now },
  lastSeen: {
    type: mongoose.Schema.Types.Mixed,
    default: {} // { "userId": "2026-02-07..." }
  },
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Channel', ChannelSchema);
