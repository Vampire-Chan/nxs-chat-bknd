const router = require('express').Router();
const auth = require('../middleware/auth');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const Message = require('../models/Message');
const Channel = require('../models/Channel');

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

const upload = multer({ storage: storage });

// UPLOAD MEDIA & CREATE MESSAGE
router.post('/upload', auth, upload.single('file'), async (req, res) => {
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
