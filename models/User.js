const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/encryption');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  displayName: { type: String, default: "" },
  dob: { type: Date },
  gender: { type: String, enum: ['male', 'female', 'other', 'none'], default: 'none' },
  totpSecret: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  isSetupComplete: { type: Boolean, default: false },
  
  email: { type: String, default: "" }, 
  avatar: { type: String, default: "" },
  banner: { type: String, default: "" },
  bio: { type: String, default: "" },
  
  badges: [{ 
    type: { type: String, enum: ['developer', 'tester', 'early_access', 'beta', 'premium', 'architect', 'moderator'] },
    label: String
  }],

  realms: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Realm' }],
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['online', 'idle', 'dnd', 'offline'], default: 'online' },
  isPrivate: { type: Boolean, default: true },
  showAge: { type: Boolean, default: false },
  showGender: { type: Boolean, default: false },
  isDisabled: { type: Boolean, default: false },
  isShadowBanned: { type: Boolean, default: false },
  scheduledDeletion: { type: Date, default: null },
  
  inboundRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  outboundRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  
  tier: { type: String, enum: ['standard', 'elite'], default: 'standard' },
  creationUI: { type: String, enum: ['auto', 'bar', 'button'], default: 'auto' },
  customStatus: { type: String, default: "" },
  
  recoveryKeys: [{
    code: { type: String },
    isUsed: { type: Boolean, default: false }
  }],
  isAdmin: { type: Boolean, default: false },
  frequencyMap: {
    type: Map,
    of: Number,
    default: {}
  },
  lastSeenAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

// Encrypt sensitive fields before saving
UserSchema.pre('save', function() {
  if (this.isModified('totpSecret')) {
    this.totpSecret = encrypt(this.totpSecret);
  }
  if (this.isModified('recoveryKeys')) {
    this.recoveryKeys.forEach(key => {
      // Only encrypt if it's not already appearing encrypted
      if (key.code && !key.code.includes(':')) {
        key.code = encrypt(key.code);
      }
    });
  }
});

module.exports = mongoose.model('User', UserSchema);
