const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, enum: ['premium_sub'], default: 'premium_sub' },
  amount: { type: String, required: true },
  method: { type: String, enum: ['UPI', 'CRYPTO', 'PAYPAL'], required: true },
  transactionId: { type: String, required: true, unique: true }, // The UTR or Hash
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', TransactionSchema);
