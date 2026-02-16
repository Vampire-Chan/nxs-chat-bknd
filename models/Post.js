const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
  channel: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },
  sourceRealm: { type: mongoose.Schema.Types.ObjectId, ref: 'Realm' },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  imageUrl: { type: String, required: true }, // Cloudinary URL
  caption: { type: String, default: "" },
  tags: [{ type: String }], // Added
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isPublic: { type: Boolean, default: false },
  detectedSectors: [{ type: String }],
  aiAnalysis: {
    mood: String,
    confidence: Number,
    tokens: [String]
  },
  comments: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: String,
    parentCommentId: { type: mongoose.Schema.Types.ObjectId }, // Added for chain comments
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Post', PostSchema);
