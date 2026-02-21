const router = require('express').Router();
const User = require('../models/User');
const Realm = require('../models/Realm');
const Post = require('../models/Post');
const auth = require('../middleware/auth');

// GLOBAL MATRIX SEARCH (Robust Calibration)
router.get('/', auth, async (req, res) => {
  const { q, type, sortBy, author, startDate, endDate } = req.query;
  if (!q && !author && !startDate) return res.json({ users: [], realms: [], posts: [] });

  try {
    const regex = new RegExp(q, 'i');
    const results = { users: [], realms: [], posts: [] };

    // 1. SEARCH USERS
    if (!type || type === 'users') {
      results.users = await User.find({ 
        $and: [
          { $or: [{ username: regex }, { displayName: regex }] },
          { isDisabled: { $ne: true } }
        ]
      }).limit(10).select('username avatar displayName tier badges');
    }

    // 2. SEARCH REALMS (Sync with name and owner)
    if (!type || type === 'realms') {
      results.realms = await Realm.find({ 
        $or: [{ name: regex }, { vanityHandle: regex }],
        isSystem: { $ne: true } 
      })
      .populate('owner', 'username avatar')
      .limit(10);
    }

    // 3. SEARCH POSTS (Robust filtering)
    if (!type || type === 'posts') {
      let postQuery = { 
        $or: [{ caption: regex }, { 'comments.text': regex }],
        isPublic: true 
      };

      if (author) {
        const authorUser = await User.findOne({ username: author });
        if (authorUser) postQuery.author = authorUser._id;
      }

      if (startDate || endDate) {
        postQuery.createdAt = {};
        if (startDate) postQuery.createdAt.$gte = new Date(startDate);
        if (endDate) postQuery.createdAt.$lte = new Date(endDate);
      }

      let queryExec = Post.find(postQuery).populate('author', 'username avatar').limit(20);

      // Sorting Logic
      if (sortBy === 'likes') queryExec = queryExec.sort({ 'likes.length': -1 });
      else if (sortBy === 'comments') queryExec = queryExec.sort({ 'comments.length': -1 });
      else queryExec = queryExec.sort({ createdAt: -1 });

      results.posts = await queryExec;
    }

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
