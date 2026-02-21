const mongoose = require('mongoose');

const RealmSchema = new mongoose.Schema({
  name: { type: String, required: true },
  icon: { type: String, default: "" },
  banner: { type: String, default: "" },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // SOVEREIGN ROLE MATRIX
  roles: [{
    name: { type: String, required: true },
    color: { type: String, default: "#00d2ff" },
    permissions: [{ type: String, enum: ['ADMIN', 'MANAGE_CHANNELS', 'KICK_MEMBERS', 'BAN_MEMBERS', 'POST_ANNOUNCEMENTS'] }],
    position: { type: Number, default: 0 }
  }],

  // MEMBER -> ROLE MAPPING
  memberRoles: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    roleId: { type: String } // Refers to the ID in the roles array
  }],

  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  channels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }],
  
  vanityHandle: { type: String, unique: true, sparse: true },
  isDiscoverable: { type: Boolean, default: false },
  isSystem: { type: Boolean, default: false },
  tier: { type: String, enum: ['standard', 'elite'], default: 'standard' },
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Realm', RealmSchema);
