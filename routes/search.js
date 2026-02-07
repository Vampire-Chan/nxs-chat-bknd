const router = require('express').Router();
const User = require('../models/User');
const Realm = require('../models/Realm');
const Post = require('../models/Post');
const auth = require('../middleware/auth');

// GLOBAL MATRIX SEARCH
router.get('/', auth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ users: [], realms: [], posts: [] });

  try {
    const regex = new RegExp(q, 'i');
    
    const [users, realms, posts] = await Promise.all([
      User.find({ $or: [{ username: regex }, { displayName: regex }] }).limit(5).select('username avatar displayName'),
      Realm.find({ name: regex }).limit(5),
      Post.find({ caption: regex }).limit(5).populate('author', 'username avatar')
    ]);

    res.json({ users, realms, posts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// FAST MENTIONS SEARCH (Ultra-lightweight)
router.get('/mentions', auth, async (req, res) => {
  const { q } = req.query;
  try {
    const users = await User.find({ 
      username: { $regex: `^${q}`, $options: 'i' } 
    }).limit(8).select('username avatar displayName');
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;