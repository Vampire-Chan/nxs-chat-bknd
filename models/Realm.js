const mongoose = require('mongoose');

const RealmSchema = new mongoose.Schema({
  name: { type: String, required: true },
  icon: { type: String, default: "" },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // ROLES & SOVEREIGNTY
  moderators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  verifiedMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // For Announcement Posting
  
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  channels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }],
  
  vanityHandle: { type: String, unique: true, sparse: true },
  tier: { type: String, enum: ['standard', 'elite'], default: 'standard' },
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Realm', RealmSchema);
