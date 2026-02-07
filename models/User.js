const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  displayName: { type: String, default: "" },
  dob: { type: Date },
  totpSecret: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  isSetupComplete: { type: Boolean, default: false },
  
  email: { type: String, default: "" }, 
  avatar: { type: String, default: "" },
  banner: { type: String, default: "" },
  bio: { type: String, default: "" },
  
  // IDENTITY BADGES
  badges: [{ 
    type: { type: String, enum: ['developer', 'tester', 'early_access', 'beta', 'premium', 'architect', 'moderator'] },
    label: String
  }],

  realms: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Realm' }],
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['online', 'idle', 'dnd', 'offline'], default: 'online' },
  isPrivate: { type: Boolean, default: false },
  
  inboundRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  outboundRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  
  vanityHandle: { type: String, unique: true, sparse: true },
  tier: { type: String, enum: ['standard', 'elite'], default: 'standard' },
  customStatus: { type: String, default: "" },
  
  recoveryKeys: [{
    code: { type: String },
    isUsed: { type: Boolean, default: false }
  }],
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
