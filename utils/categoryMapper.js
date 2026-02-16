/**
 * Neural Resonance Sector Mapping
 * Maps raw tags/keywords to Global Matrix Sectors
 */

const SECTOR_MAP = {
  gaming: ['gaming', 'rpg', 'fps', 'steam', 'xbox', 'playstation', 'nintendo', 'multiplayer', 'esports'],
  gamedev: ['gamedev', 'unreal', 'ue5', 'unity', 'coding', 'programming', '3dart', 'blender', 'blueprint', 'cpp'],
  music: ['music', 'synthwave', 'lofi', 'techno', 'audio', 'spotify', 'playlist', 'beats', 'production'],
  politics: ['news', 'election', 'policy', 'economy', 'government', 'worldevents', 'activism'],
  tech: ['tech', 'ai', 'hardware', 'cybersecurity', 'crypto', 'web3', 'decentralized', 'software'],
  art: ['art', 'design', 'photography', 'creative', 'illustration', 'visuals', 'aesthetic']
};

/**
 * Identifies which sectors a post belongs to based on its tags/caption
 */
exports.getSectors = (tags = [], caption = "") => {
  const sectors = new Set();
  const text = (caption + " " + tags.join(" ")).toLowerCase();

  Object.entries(SECTOR_MAP).forEach(([sector, keywords]) => {
    if (keywords.some(k => text.includes(k.toLowerCase()))) {
      sectors.add(sector);
    }
  });

  return Array.from(sectors);
};

/**
 * Updates a user's frequency map based on interaction
 * @param {Object} user - Mongoose User Document
 * @param {Array} tags - Post tags
 * @param {String} caption - Post caption
 * @param {Number} weight - Positive for like/comment, negative for "not interested"
 */
exports.updateResonance = async (user, tags, caption, weight = 1) => {
  const postSectors = exports.getSectors(tags, caption);
  
  if (!user.frequencyMap) user.frequencyMap = new Map();

  // Boost Category resonance
  postSectors.forEach(sector => {
    const current = user.frequencyMap.get(sector) || 0;
    user.frequencyMap.set(sector, Math.max(0, current + (weight * 5))); // Categories have higher weight
  });

  // Boost raw tag resonance
  tags.forEach(tag => {
    const current = user.frequencyMap.get(tag.toLowerCase()) || 0;
    user.frequencyMap.set(tag.toLowerCase(), Math.max(0, current + weight));
  });

  // Keep map lean: Remove scores that have decayed to 0
  for (let [key, val] of user.frequencyMap) {
    if (val <= 0) user.frequencyMap.delete(key);
  }

  user.markModified('frequencyMap');
  await user.save();
};
