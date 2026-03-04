const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['premium_sub'], default: 'premium_sub' },
  amount: { type: Number, required: true },
  method: { type: String, enum: ['UPI', 'CRYPTO', 'PAYPAL'], required: true },
  transactionId: { type: String, required: true, unique: true }, // The UTR or Hash
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

TransactionSchema.index({ user: 1, createdAt: -1 });
TransactionSchema.index({ status: 1 });

module.exports = mongoose.model('Transaction', TransactionSchema);
