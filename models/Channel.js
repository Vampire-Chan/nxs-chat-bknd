const mongoose = require('mongoose');

const ChannelSchema = new mongoose.Schema({
  realm: { type: mongoose.Schema.Types.ObjectId, ref: 'Realm' }, // Optional for DMs
  name: { type: String }, // Optional for DMs (auto-generated)
  type: { type: String, enum: ['text', 'feed', 'dm', 'reels'], default: 'text' },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // For DMs
  status: { type: String, enum: ['active', 'pending'], default: 'active' }, // Added
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Channel', ChannelSchema);
