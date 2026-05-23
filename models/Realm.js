const mongoose = require('mongoose');

const RealmSchema = new mongoose.Schema({
  name: { type: String, required: true },
  icon: { type: String, default: "" },
  banner: { type: String, default: "" },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // SOVEREIGN ROLE MATRIX
  roles: [{
    name: { type: String, required: true },
    key: { type: String, default: null },
    isSystem: { type: Boolean, default: false },
    color: { type: String, default: "#00d2ff" },
    permissions: [{ type: String, enum: ['ADMINISTRATOR', 'MANAGE_REALM', 'MANAGE_ROLES', 'MANAGE_CATEGORIES', 'MANAGE_CHANNELS', 'MANAGE_MESSAGES', 'MANAGE_MEDIA', 'VIEW_CHANNEL', 'SEND_MESSAGES', 'CREATE_POSTS', 'CONNECT', 'SPEAK', 'STREAM'] }],
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
