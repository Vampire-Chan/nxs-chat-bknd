const router = require('express').Router();
const mongoose = require('mongoose');
const Post = require('../models/Post');
const auth = require('../middleware/auth');
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
    const { caption, channelId } = req.body;
    
    if (!req.file) {
      console.error('❌ Upload Failed: No file provided');
      return res.status(400).json({ message: "Visual data required." });
    }

    const postData = {
      caption: caption || "",
      imageUrl: req.file.path,
      author: req.user.id
    };

    // Only assign channel if it's a valid ObjectId (not 'global')
    if (channelId && mongoose.Types.ObjectId.isValid(channelId)) {
      postData.channel = channelId;
    }

    const newPost = new Post(postData);
    const saved = await newPost.save();
    console.log('✅ Post saved to DB:', saved._id);

    const populated = await Post.findById(saved._id).populate('author', 'username avatar');
    
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

// EDIT BROADCAST
router.put('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Broadcast lost" });
    if (post.author.toString() !== req.user.id) return res.status(403).json({ message: "Unauthorized node" });

    post.caption = req.body.caption || post.caption;
    await post.save();
    res.json(post);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SEVER BROADCAST (Delete)
router.delete('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Broadcast not found" });
    if (post.author.toString() !== req.user.id) return res.status(403).json({ message: "Unauthorized node" });

    // Delete image from Cloudinary if needed (optional optimization)
    await post.deleteOne();
    res.json({ message: "Broadcast severed from matrix" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET ALL (Global Matrix - Public Only)
router.get('/all', auth, async (req, res) => {
  try {
    // 1. Find all private users
    const privateUsers = await require('../models/User').find({ isPrivate: true }).distinct('_id');
    
    // 2. Fetch posts where author is NOT in private list
    const posts = await Post.find({ author: { $nin: privateUsers } })
      .populate('author', 'username avatar')
      .sort({ createdAt: -1 });
      
    res.json(posts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET USER POSTS
router.get('/user/:userId', auth, async (req, res) => {
  try {
    const posts = await Post.find({ author: req.params.userId }).populate('author', 'username avatar').sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// LIKE
router.post('/:id/like', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    const index = post.likes.indexOf(req.user.id);
    if (index === -1) post.likes.push(req.user.id);
    else post.likes.splice(index, 1);
    await post.save();
    res.json({ likes: post.likes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADD COMMENT
router.post('/:id/comment', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Broadcast lost" });

    const newComment = {
      text: req.body.text,
      user: req.user.id,
      createdAt: new Date()
    };

    post.comments.push(newComment);
    await post.save();

    // Return the specific comment with user info populated for frontend
    const populatedPost = await Post.findById(post._id).populate('comments.user', 'username avatar');
    res.json(populatedPost.comments[populatedPost.comments.length - 1]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;