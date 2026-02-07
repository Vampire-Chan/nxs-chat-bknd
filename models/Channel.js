const mongoose = require('mongoose');

const ChannelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['text', 'voice', 'feed', 'reels', 'announcement', 'dm', 'group_dm'], default: 'text' },
  realm: { type: mongoose.Schema.Types.ObjectId, ref: 'Realm' },
  
  // Group DM Support
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  maxMembers: { type: Number, default: 50 }, // Limited to 50 as requested
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Channel', ChannelSchema);