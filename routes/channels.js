const router = require('express').Router();
const Message = require('../models/Message');
const Post = require('../models/Post');
const Channel = require('../models/Channel');
const Realm = require('../models/Realm');
const auth = require('../middleware/auth');

// Middleware to check if user has access to channel
const checkChannelAccess = async (req, res, next) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ message: "Channel node lost" });

    if (channel.type === 'dm') {
      // For DMs, user must be in the members list
      if (!channel.members.includes(req.user.id)) {
        return res.status(403).json({ message: "Access denied to private link" });
      }
    } else {
      // For Realm channels, user must be a member of the parent Realm
      const realm = await Realm.findById(channel.realm);
      if (!realm || !realm.members.includes(req.user.id)) {
        return res.status(403).json({ message: "Identity not authorized for this realm" });
      }
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nexus-chat-media',
    resource_type: 'auto',
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'mp4', 'mov', 'webm']
  }
});
const upload = multer({ storage });

// POST Message with Media
router.post('/:id/messages', auth, upload.single('file'), async (req, res) => {
  try {
    const { content } = req.body;
    let mediaUrl = null;
    let mediaType = null;

    if (req.file) {
      mediaUrl = req.file.path;
      mediaType = req.file.mimetype.startsWith('video') ? 'video' : 'image';
    }

    const newMessage = new Message({
      channel: req.params.id,
      sender: req.user.id,
      content,
      mediaUrl,
      mediaType
    });

    await newMessage.save();
    await newMessage.populate('sender', 'username avatar');
    res.json(newMessage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Messages for a Channel
router.get('/:id/messages', auth, checkChannelAccess, async (req, res) => {
  try {
    const messages = await Message.find({ channel: req.params.id })
      .populate('sender', 'username avatar')
      .sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Posts for a Channel
router.get('/:id/posts', auth, checkChannelAccess, async (req, res) => {
  try {
    const posts = await Post.find({ channel: req.params.id })
      .populate('author', 'username avatar')
      .populate('comments.user', 'username avatar')
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;