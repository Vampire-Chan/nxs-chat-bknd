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

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB Max for Posts
});

const validatePostLimit = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "Identity lost." });

    const isElite = user.tier === 'elite' || user.isAdmin;
    const limit = isElite ? 1024 * 1024 * 1024 : 100 * 1024 * 1024;

    const contentLength = parseInt(req.headers['content-length'] || '0');
    if (contentLength > limit) {
      return res.status(413).json({ message: `Post too heavy. Limit: ${limit / (1024 * 1024)}MB.` });
    }
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// CREATE
router.post('/', auth, validatePostLimit, upload.single('file'), async (req, res) => {
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

// GET ALL (Global Matrix - Public Only with MMFR 2.0 Algorithm)
router.get('/all', auth, async (req, res) => {
  try {
    const { tag, page = 1 } = req.query;
    const limit = 50;
    const skip = (page - 1) * limit;

    const User = require('../models/User');
    const currentUser = await User.findById(req.user.id);
    
    // BASE QUERY: Public posts only
    const baseQuery = { 
      $or: [
        { isPublic: true },
        { channel: { $exists: false } },
        { channel: null }
      ]
    };

    if (tag) {
      baseQuery.tags = { $in: [tag] };
    }

    // 1. Fetch Fresh Matrix (Last 7 days)
    const freshPosts = await Post.find({
      ...baseQuery,
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    })
    .populate('author', 'username avatar displayName isPrivate isDisabled')
    .populate('sourceRealm', 'name icon isDiscoverable')
    .populate('comments.user', 'username avatar displayName isPrivate')
    .sort({ createdAt: -1 })
    .limit(150);

    // 2. Fetch "Echoes" (Grave Digging: > 15 days old, high engagement)
    const echoes = await Post.find({
      ...baseQuery,
      createdAt: { $lt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
      $expr: { $gt: [{ $size: "$likes" }, 5] } // Only dig up liked content
    })
    .populate('author', 'username avatar displayName isPrivate isDisabled')
    .populate('sourceRealm', 'name icon isDiscoverable')
    .sort({ 'likes.length': -1 })
    .limit(20);

    const now = new Date();
    const authorCounts = {}; // For Diversity Logic

    const allCandidatePosts = [...freshPosts, ...echoes];

    const scoredPosts = allCandidatePosts
      .filter(p => {
        if (!p.author || p.author.isDisabled) return false;
        const isMe = p.author._id.toString() === req.user.id;
        // Matrix Discovery Protocol: If a post is explicitly public, anyone can see it.
        // If it's not public, only show if it's Me OR the author is NOT private.
        return p.isPublic || isMe || !p.author.isPrivate;
      })
      .map(post => {
        let score = 0;
        const ageInHours = (now - new Date(post.createdAt)) / (1000 * 60 * 60);
        const isEcho = ageInHours > (15 * 24);

        // A. GRAVITY (Social Engagement)
        const followedLikes = post.likes.filter(id => 
          currentUser.following.includes(id) || currentUser.friends.includes(id)
        ).length;
        
        const rawEngagement = post.likes.length + (post.comments.length * 2);
        score += (followedLikes * 20); // Massive weight for social circle
        score += (rawEngagement * 2);

        // B. VELOCITY (Recent Spark)
        // If post is new (< 24h), calculate how fast it's growing
        const velocity = ageInHours < 24 ? (rawEngagement / (ageInHours + 0.5)) : 0;
        score += (velocity * 10);

        // C. NEURAL RESONANCE (Interest Alignment)
        const postSectors = post.detectedSectors || [];
        const postTags = post.tags || [];
        const resonancePool = [...postSectors, ...postTags];
        
        let resonanceScore = 0;
        let isHighFriction = postSectors.includes('politics');
        let userHasInterestInFriction = false;

        resonancePool.forEach(term => {
          const interest = currentUser.frequencyMap?.get(term.toLowerCase()) || 0;
          resonanceScore += (interest * 3);
          if (isHighFriction && term.toLowerCase() === 'politics' && interest > 5) {
            userHasInterestInFriction = true;
          }
        });

        // SAFETY: The "Cartoon vs Politics" Filter
        if (isHighFriction && !userHasInterestInFriction) {
          score -= 500; // Bury it deep
        }
        score += resonanceScore;

        // D. DIVERSITY (Anti-Flood)
        const authorId = post.author._id.toString();
        authorCounts[authorId] = (authorCounts[authorId] || 0) + 1;
        const diversityPenalty = Math.max(0, (authorCounts[authorId] - 2) * 15);
        score -= diversityPenalty;

        // E. TEMPORAL DECAY (The Pulse)
        // Echoes get a "Resurrection Boost" to overcome their age
        const decayPower = isEcho ? 0.8 : 1.8; 
        const echoBoost = isEcho ? 50 : 0;
        
        const finalScore = (score + echoBoost) / Math.pow(ageInHours + 2, decayPower);

        return { 
          ...post.toObject(), 
          resonanceScore: finalScore,
          isEcho: isEcho,
          debug: { velocity, resonance: resonanceScore, diversity: diversityPenalty }
        };
      });

    // Sort by final MMFR Score
    const sorted = scoredPosts.sort((a, b) => b.resonanceScore - a.resonanceScore);
    
    // Apply Pagination
    const paginated = sorted.slice(skip, skip + limit);
      
    res.json(paginated);
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

    // AUTO-CLEAR NOTIFICATIONS FOR THIS POST
    await Notification.updateMany({ recipient: req.user.id, 'metadata.postId': post._id, isRead: false }, { $set: { isRead: true } });

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
    
    // AUTO-CLEAR NOTIFICATIONS FOR THIS POST
    await Notification.updateMany({ recipient: req.user.id, 'metadata.postId': post._id, isRead: false }, { $set: { isRead: true } });

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
