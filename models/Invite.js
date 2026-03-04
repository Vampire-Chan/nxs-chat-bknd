const mongoose = require('mongoose');

const InviteSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  realm: { type: mongoose.Schema.Types.ObjectId, ref: 'Realm', required: true },
  inviter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uses: { type: Number, default: 0 },
  maxUses: { type: Number, default: 0 }, // 0 = infinite
  expiresAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Invite', InviteSchema);
