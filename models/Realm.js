const mongoose = require('mongoose');

const RealmSchema = new mongoose.Schema({
  name: { type: String, required: true },
  icon: { type: String, default: "" }, // Cloudinary URL
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  channels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Realm', RealmSchema);
