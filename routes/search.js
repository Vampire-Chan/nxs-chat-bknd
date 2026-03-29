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
    const queryText = typeof q === 'string' ? q.trim() : '';
    const escapedQ = queryText ? queryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
    const regex = escapedQ ? new RegExp(escapedQ, 'i') : null;
    const results = { users: [], realms: [], posts: [] };

    // 1. SEARCH USERS
    if (!type || type === 'users') {
      if (!regex) {
        results.users = [];
      } else {
      results.users = await User.find({ 
        $and: [
          { $or: [{ username: regex }, { displayName: regex }] },
          { isDisabled: { $ne: true } }
        ]
      }).limit(10).select('username avatar displayName tier badges');
      }
    }

    // 2. SEARCH REALMS (Sync with name and owner)
    if (!type || type === 'realms') {
      if (!regex) {
        results.realms = [];
      } else {
      results.realms = await Realm.find({ 
        $or: [{ name: regex }, { vanityHandle: regex }],
        isSystem: { $ne: true } 
      })
      .populate('owner', 'username avatar')
      .limit(10);
      }
    }

    // 3. SEARCH POSTS (Robust filtering)
    if (!type || type === 'posts') {
      let postQuery = { isPublic: true };
      if (regex) {
        postQuery.$or = [{ caption: regex }, { 'comments.text': regex }];
      }

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
      // Note: sort by array length requires post-query sorting
      queryExec = queryExec.sort({ createdAt: -1 });

      let posts = await queryExec;
      if (sortBy === 'likes') posts.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0));
      else if (sortBy === 'comments') posts.sort((a, b) => (b.comments?.length || 0) - (a.comments?.length || 0));
      results.posts = posts;
    }

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
