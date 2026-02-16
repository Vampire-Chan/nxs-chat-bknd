const mongoose = require('mongoose');

const TrendSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "Spatial Computing"
  tags: [{ type: String }], // e.g., ["visionpro", "xr", "spatial"]
  score: { type: Number, default: 0 }, // How "hot" this trend is
  generatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date } // Trends shouldn't last forever
});

module.exports = mongoose.model('Trend', TrendSchema);
