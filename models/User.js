const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  displayName: { type: String, default: "" },
  dob: { type: Date },
  totpSecret: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  isSetupComplete: { type: Boolean, default: false },
  
  // Optional Profile Fields
  email: { type: String, default: "" }, 
  avatar: { type: String, default: "" },
  banner: { type: String, default: "" },
  bio: { type: String, default: "" },
  realms: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Realm' }],
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['online', 'idle', 'dnd', 'offline'], default: 'online' },
  isPrivate: { type: Boolean, default: false },
  customStatus: { type: String, default: "" },
  
  // SECURITY MATRIX
  recoveryKeys: [{
    code: { type: String },
    isUsed: { type: Boolean, default: false }
  }],
  isAdmin: { type: Boolean, default: false }, // Added
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);