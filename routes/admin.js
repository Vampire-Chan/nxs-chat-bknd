const router = require('express').Router();
const User = require('../models/User');
const Post = require('../models/Post');
const Realm = require('../models/Realm');
const auth = require('../middleware/auth');

// Middleware to check if user is Architect
const architectOnly = async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (user && user.isAdmin) {
    next();
  } else {
    res.status(403).json({ message: "ACCESS_DENIED: Identity is not an Architect." });
  }
};

// GET GLOBAL STATS
router.get('/stats', auth, architectOnly, async (req, res) => {
  try {
    const counts = {
      users: await User.countDocuments(),
      posts: await Post.countDocuments(),
      realms: await Realm.countDocuments()
    };
    res.json(counts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// LIST ALL BROADCASTS (For Moderation)
router.get('/broadcasts', auth, architectOnly, async (req, res) => {
  try {
    const posts = await Post.find()
      .populate('author', 'username avatar')
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SEVER ANY BROADCAST
router.delete('/broadcasts/:id', auth, architectOnly, async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: "Broadcast purged by Architect oversight." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// LIST ALL IDENTITIES
router.get('/identities', auth, architectOnly, async (req, res) => {
  try {
    const users = await User.find().select('-totpSecret');
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SEVER IDENTITY NODE (Ban)
router.delete('/identities/:id', auth, architectOnly, async (req, res) => {
  try {
    // In a real app, we'd flag them as banned. For now, total deletion.
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Identity node permanently severed from Nexus." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
