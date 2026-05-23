const mongoose = require('mongoose');

const ChannelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['category', 'text', 'voice', 'media', 'gallery', 'matrix', 'feed', 'reels', 'announcement', 'dm', 'group_dm', 'mod_reports', 'mod_messages', 'mod_posts', 'mod_users', 'mod_stats'], 
    default: 'text' 
  },
  realm: { type: mongoose.Schema.Types.ObjectId, ref: 'Realm' },
  parentCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', default: null },
  position: { type: Number, default: 0 },
  topic: { type: String, default: '' },
  nsfw: { type: Boolean, default: false },
  permissionOverwrites: [{
    targetType: { type: String, enum: ['role', 'member'], required: true },
    targetId: { type: String, required: true },
    allow: [{ type: String }],
    deny: [{ type: String }]
  }],
  
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

// Performance indexes
ChannelSchema.index({ type: 1, members: 1 });
ChannelSchema.index({ realm: 1 });
ChannelSchema.index({ realm: 1, parentCategory: 1, position: 1 });

module.exports = mongoose.model('Channel', ChannelSchema);
