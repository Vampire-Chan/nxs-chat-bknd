const router = require('express').Router();
const mongoose = require('mongoose');
const Post = require('../models/Post');
const User = require('../models/User');
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');
const resonance = require('../utils/categoryMapper');
const aiOracle = require('../utils/aiOracle');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'nexus-posts', resource_type: 'auto' }
});

const upload = multer({ storage: storage });

// CREATE
router.post('/', auth, upload.single('file'), async (req, res) => {
  console.log('📤 POST Request to /api/posts');
  console.log('📦 Body:', req.body);
  console.log('📎 File:', req.file ? req.file.path : 'MISSING');

  try {
    const { caption, channelId, isPublic: isPublicStr } = req.body;
    const User = require('../models/User');
    const Channel = require('../models/Channel');
    
    if (!req.file) {
      console.error('❌ Upload Failed: No file provided');
      return res.status(400).json({ message: "Visual data required." });
    }

    const user = await User.findById(req.user.id);
    let isPublic = isPublicStr === 'true';
    let tags = req.body.tags ? (Array.isArray(req.body.tags) ? req.body.tags : req.body.tags.split(',')) : [];

    // Tag Extraction Protocol: Scan caption for #hashtags if tags array is empty
    if (tags.length === 0 && caption) {
      const extracted = caption.match(/#(\w+)/g);
      if (extracted) {
        tags = extracted.map(t => t.substring(1).toLowerCase());
      }
    }

    const postData = {
      caption: caption || "",
      imageUrl: req.file.path,
      author: req.user.id,
      isPublic: isPublic,
      tags: tags,
      detectedSectors: [], // Initializing empty for worker to process
      aiAnalysis: {
        mood: "pending",
        confidence: 0,
        tokens: tags
      }
    };

    // Only assign channel if it's a valid ObjectId (not 'global')
    if (channelId && mongoose.Types.ObjectId.isValid(channelId)) {
      postData.channel = channelId;
      
      // Find source realm
      const channel = await Channel.findById(channelId);
      if (channel && channel.realm) {
        postData.sourceRealm = channel.realm;
      }
    }

    const newPost = new Post(postData);
    const saved = await newPost.save();
    console.log('✅ Post saved to DB:', saved._id);

    const populated = await Post.findById(saved._id)
      .populate('author', 'username avatar displayName showAge dob isPrivate')
      .populate('sourceRealm', 'name icon isDiscoverable');
    
    // Real-time broadcast if channel exists
    const io = req.app.get('socketio');
    if (io && postData.channel) {
      io.to(postData.channel.toString()).emit('receive_post', populated);
    }

    res.json(populated);
  } catch (err) { 
    console.error('💥 Internal Server Error in /api/posts:', err);
    res.status(500).json({ error: err.message }); 
  }
});

// EDIT
router.put('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Transmission lost." });
    
    if (post.author.toString() !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized node modification." });
    }

    post.caption = req.body.caption || post.caption;
    await post.save();
    
    res.json({ message: "Broadcast recalibrated.", post });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE (SEVER)
router.delete('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Broadcast already purged." });
    
    if (post.author.toString() !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized severance." });
    }

    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: "Transmission erased from matrix." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET ALL (Global Matrix - Public Only with Resonance Algorithm)
router.get('/all', auth, async (req, res) => {
  try {
    const { tag } = req.query;
    const User = require('../models/User');
    const currentUser = await User.findById(req.user.id);
    
    const query = { 
      $or: [
        { isPublic: true },
        { channel: { $exists: false } },
        { channel: null }
      ]
    };

    if (tag) {
      query.tags = { $in: [tag] };
    }

    // Fetch potential posts
    const posts = await Post.find(query)
      .populate('author', 'username avatar displayName isPrivate isDisabled')
      .populate('sourceRealm', 'name icon isDiscoverable')
      .populate('comments.user', 'username avatar displayName isPrivate')
      .sort({ createdAt: -1 })
      .limit(200);

    const now = new Date();

    // The Resonance Synthesizer
    const scoredPosts = posts
      .filter(p => {
        if (!p.author || p.author.isDisabled) return false;
        const isMe = p.author._id.toString() === req.user.id;
        return isMe || !p.author.isPrivate;
      })
      .map(post => {
        let score = 0;
        const hoursOld = (now - new Date(post.createdAt)) / (1000 * 60 * 60);

        // 1. NETWORK GRAVITY (Weight: 40)
        // Check if nodes I follow have liked this
        const followedLikes = post.likes.filter(id => 
          currentUser.following.includes(id) || currentUser.friends.includes(id)
        ).length;
        score += (followedLikes * 15);

        // 2. CATEGORY RESONANCE (Weight: 40)
        // Combine AI detected sectors and manual tags
        const resonancePool = [...(post.detectedSectors || []), ...(post.tags || [])];
        resonancePool.forEach(tag => {
          const resonanceValue = currentUser.frequencyMap?.get(tag.toLowerCase()) || 0;
          score += (resonanceValue * 2); // Each point of interest adds to score
        });

        // 3. TEMPORAL DECAY (The Pulse)
        // We divide the score by hours passed (Gravity effect)
        // Fresh posts (0-1h) keep full score, older ones fade
        const decayFactor = Math.pow(hoursOld + 2, 1.5); 
        const finalScore = score / decayFactor;

        // Add a small "Discovery" boost for brand new posts to let them enter the matrix
        const discoveryBoost = hoursOld < 1 ? 5 : 0;

        return { 
          ...post.toObject(), 
          resonanceScore: finalScore + discoveryBoost,
          debug: { gravity: followedLikes, resonance: score, age: hoursOld }
        };
      });

    // Sort by final Resonance Score
    const sorted = scoredPosts.sort((a, b) => b.resonanceScore - a.resonanceScore);
      
    res.json(sorted);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET USER POSTS
router.get('/user/:userId', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) return res.status(404).json({ message: "Node not found." });

    const isMe = req.user.id === req.params.userId;
    const isFriend = targetUser.friends.some(id => id.toString() === req.user.id);

    // Privacy Guard: If target is private, only allow if Me or Friend
    if (targetUser.isPrivate && !isMe && !isFriend) {
      return res.status(403).json({ message: "Access restricted by privacy protocols." });
    }

    const posts = await Post.find({ author: req.params.userId })
      .populate('author', 'username avatar displayName showAge dob isPrivate')
      .populate('sourceRealm', 'name icon isDiscoverable')
      .populate('comments.user', 'username avatar displayName isPrivate')
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// LIKE
router.post('/:id/like', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    const User = require('../models/User');
    const user = await User.findById(req.user.id);

    const index = post.likes.indexOf(req.user.id);
    if (index === -1) {
      post.likes.push(req.user.id);
      // Boost resonance for liking
      await resonance.updateResonance(user, post.tags, post.caption, 1);
      
      // NOTIFICATION: Liked broadcast
      if (post.author.toString() !== req.user.id) {
        const notif = new Notification({
          recipient: post.author,
          sender: req.user.id,
          type: 'like',
          content: 'linked with your transmission.',
          metadata: { postId: post._id }
        });
        await notif.save();
        
        const populatedNotif = await Notification.findById(notif._id).populate('sender', 'username avatar');
        const io = req.app.get('socketio');
        if (io) {
          io.to(post.author.toString()).emit('new_notification', populatedNotif);
          io.to(post.author.toString()).emit('identity_sync_update');
        }
      }
    } else {
      post.likes.splice(index, 1);
      // Reduce resonance for unliking
      await resonance.updateResonance(user, post.tags, post.caption, -1);
    }
    await post.save();
    res.json({ likes: post.likes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADD COMMENT
router.post('/:id/comment', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Broadcast lost" });

    const { text, parentCommentId } = req.body;

    const newComment = {
      text: text,
      user: req.user.id,
      parentCommentId: parentCommentId || null,
      createdAt: new Date()
    };

    post.comments.push(newComment);
    const savedPost = await post.save();
    const latestComment = savedPost.comments[savedPost.comments.length - 1];

    // Resonance Boost for commenting (High Engagement)
    const user = await User.findById(req.user.id);
    await resonance.updateResonance(user, post.tags, post.caption, 2);

    // NOTIFICATION LOGIC
    const io = req.app.get('socketio');

    // 1. Notify Post Owner
    if (post.author.toString() !== req.user.id) {
      const notif = new Notification({
        recipient: post.author,
        sender: req.user.id,
        type: 'comment',
        content: 'added data to your broadcast.',
        metadata: { postId: post._id }
      });
      await notif.save();
      const populated = await Notification.findById(notif._id).populate('sender', 'username avatar');
      if (io) {
        io.to(post.author.toString()).emit('new_notification', populated);
        io.to(post.author.toString()).emit('identity_sync_update');
      }
    }

    // 2. Notify Parent Comment Owner (if reply)
    if (parentCommentId) {
      const parentComment = post.comments.find(c => c._id.toString() === parentCommentId);
      if (parentComment && parentComment.user.toString() !== req.user.id) {
        const notif = new Notification({
          recipient: parentComment.user,
          sender: req.user.id,
          type: 'reply',
          content: 'replied to your neural feedback.',
          metadata: { postId: post._id }
        });
        await notif.save();
        const populated = await Notification.findById(notif._id).populate('sender', 'username avatar');
        if (io) {
          io.to(parentComment.user.toString()).emit('new_notification', populated);
          io.to(parentComment.user.toString()).emit('identity_sync_update');
        }
      }
    }

    // Return the specific comment with user info populated for frontend (Include isPrivate)
    const populatedPost = await Post.findById(post._id).populate('comments.user', 'username avatar displayName showAge dob isPrivate');
    const responseComment = populatedPost.comments.find(c => c._id.toString() === latestComment._id.toString());
    
    res.json(responseComment);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET TRENDS (AI Dreams)
router.get('/trends', auth, async (req, res) => {
  try {
    const Trend = require('../models/Trend');
    // Return top 10 active trends
    const trends = await Trend.find({}).sort({ score: -1 }).limit(10);
    res.json(trends);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
