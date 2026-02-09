const router = require('express').Router();
const User = require('../models/User');
const Post = require('../models/Post');
const Realm = require('../models/Realm');
const Transaction = require('../models/Transaction');
const auth = require('../middleware/auth');

// 1. ARCHITECT & ADMIN (Full Access)
const architectOnly = async (req, res, next) => {
  const user = await User.findById(req.user.id);
  // Creator (Developer badge) or Admin flag
  const hasFullRights = user && (user.isAdmin || user.badges.some(b => b.type === 'developer' || b.type === 'architect'));
  if (hasFullRights) return next();
  res.status(403).json({ message: "ACCESS_DENIED: Full administrative clearance required." });
};

// 2. MODERATOR + ABOVE (Observation & Purge)
const oversightAccess = async (req, res, next) => {
  const user = await User.findById(req.user.id);
  const hasAccess = user && (
    user.isAdmin || 
    user.badges.some(b => b.type === 'developer' || b.type === 'architect' || b.type === 'moderator')
  );
  if (hasAccess) return next();
  res.status(403).json({ message: "ACCESS_DENIED: Oversight clearance required." });
};

// STATS (Oversight Access)
router.get('/stats', auth, oversightAccess, async (req, res) => {
  try {
    const counts = {
      users: await User.countDocuments(),
      posts: await Post.countDocuments(),
      realms: await Realm.countDocuments()
    };
    res.json(counts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// BROADCASTS (Oversight Access)
router.get('/broadcasts', auth, oversightAccess, async (req, res) => {
  try {
    const posts = await Post.find().populate('author', 'username avatar').sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE BROADCAST (Oversight Access - Mods can delete)
router.delete('/broadcasts/:id', auth, oversightAccess, async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: "Broadcast purged by oversight." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// EDIT BROADCAST (Architect Only - Mods cannot edit neural data)
router.put('/broadcasts/:id', auth, architectOnly, async (req, res) => {
  try {
    const { caption } = req.body;
    await Post.findByIdAndUpdate(req.params.id, { $set: { caption } });
    res.json({ message: "Broadcast neural data modified by Architect." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// IDENTITIES (Architect Only)
router.get('/identities', auth, architectOnly, async (req, res) => {
  try {
    const users = await User.find().select('-totpSecret');
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SEVER IDENTITY (Architect Only)
router.delete('/identities/:id', auth, architectOnly, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Identity node permanently erased." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GRANT AUTHORITY (Architect Only)
router.post('/identities/:id/authority', auth, architectOnly, async (req, res) => {
  try {
    const { badges, isAdmin } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "Identity not found." });

    if (badges !== undefined) user.badges = badges;
    if (isAdmin !== undefined) user.isAdmin = isAdmin;

    await user.save();
    res.json({ message: "Identity authority recalibrated.", user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// FINANCE (Architect Only)
router.get('/finance/pending', auth, architectOnly, async (req, res) => {
  try {
    const txs = await Transaction.find({ status: 'pending' }).populate('user', 'username avatar');
    res.json(txs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/finance/approve/:id', auth, architectOnly, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ message: "Transaction record not found." });
    
    tx.status = 'approved'; await tx.save();
    const user = await User.findById(tx.user);
    if (user) {
      user.tier = 'elite';
      if (!user.badges.some(b => b.type === 'premium')) user.badges.push({ type: 'premium', label: 'Nexus Elite' });
      await user.save();
    }
    res.json({ message: "Payment verified and identity node upgraded." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;