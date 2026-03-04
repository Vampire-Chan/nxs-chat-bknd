const router = require('express').Router();
const auth = require('../middleware/auth');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const Message = require('../models/Message');
const Channel = require('../models/Channel');
const User = require('../models/User');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nexus-chat-media',
    resource_type: 'auto', // CRITICAL: Allows audio/video/raw
  }
});

// Configure Multer with a high hard limit, but we'll use middleware for tiered limits
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB Max Hard Limit
});

// Tiered Upload Limit Middleware
const validateUploadLimit = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const channel = await Channel.findById(req.body.channelId);
    
    if (!user || !channel) return res.status(404).json({ message: "Context lost." });

    const isElite = user.tier === 'elite' || user.isAdmin;
    const isDM = channel.type === 'dm' || channel.type === 'group_dm';
    
    // Limits in Bytes
    const STANDARD_LIMIT = 100 * 1024 * 1024; // 100MB
    const ELITE_LIMIT = 1 * 1024 * 1024 * 1024; // 1GB
    const DM_LIMIT = 2 * 1024 * 1024 * 1024; // 2GB

    let currentLimit = STANDARD_LIMIT;
    if (isDM) currentLimit = DM_LIMIT;
    else if (isElite) currentLimit = ELITE_LIMIT;

    const contentLength = parseInt(req.headers['content-length'] || '0');
    
    if (contentLength > currentLimit) {
      return res.status(413).json({ 
        message: `Transmission overflow. Current limit: ${currentLimit / (1024 * 1024)}MB.`,
        required_tier: isDM ? "None (Max reached)" : "Elite"
      });
    }

    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// UPLOAD MEDIA & CREATE MESSAGE
router.post('/upload', auth, upload.single('file'), validateUploadLimit, async (req, res) => {
  try {
    const { channelId, content, mediaType } = req.body;
    if (!req.file) return res.status(400).json({ message: "No media detected." });

    const newMessage = new Message({
      channel: channelId,
      sender: req.user.id,
      content: content || "",
      mediaUrl: req.file.path,
      mediaType: mediaType || 'file'
    });

    await newMessage.save();
    const populated = await Message.findById(newMessage._id).populate('sender', 'username avatar badges tier isAdmin');

    // Broadcast via socket
    const io = req.app.get('socketio');
    if (io) {
      io.to(channelId).emit('receive_message', populated);
    }

    res.json(populated);
  } catch (err) {
    console.error("Media Upload Error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
