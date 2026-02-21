const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetType: { type: String, enum: ['message', 'post', 'user', 'realm'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true }, // The ID of the thing being reported
  reason: { type: String, required: true },
  status: { type: String, enum: ['pending', 'resolved', 'dismissed'], default: 'pending' },
  
  // Context for DM/Message reports (Snapshot of conversation)
  context: [{
    sender: { type: String }, // Username snapshot
    content: { type: String },
    timestamp: { type: Date }
  }],
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Report', ReportSchema);
