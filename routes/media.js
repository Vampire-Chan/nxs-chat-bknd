const router = require('express').Router();
const auth = require('../middleware/auth');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const Message = require('../models/Message');
const Channel = require('../models/Channel');
const Realm = require('../models/Realm');
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

// Upload size limits in bytes
const STANDARD_LIMIT = 100 * 1024 * 1024;      // 100 MB
const ELITE_LIMIT    =   1 * 1024 * 1024 * 1024; //   1 GB
const DM_LIMIT       =   2 * 1024 * 1024 * 1024; //   2 GB

// Configure Multer with a high hard limit, but we'll use middleware for tiered limits
const upload = multer({ 
  storage: storage,
  limits: { fileSize: DM_LIMIT } // 2GB Max Hard Limit
});

// Pre-upload size guard: runs BEFORE multer so oversized requests are rejected
// without uploading anything to Cloudinary. Uses only content-length + user tier.
const preUploadSizeCheck = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found." });

    // Store user on request so the route handler can reuse it
    req.uploadUser = user;

    const isElite = user.tier === 'elite' || user.isAdmin;

    // Without knowing the channel type yet, apply the per-user maximum.
    // DM channels allow the full 2 GB limit; that check is done post-upload.
    const userMax = isElite ? ELITE_LIMIT : STANDARD_LIMIT;

    const contentLength = parseInt(req.headers['content-length'] || '0');
    if (contentLength > userMax) {
      return res.status(413).json({
        message: `Transmission overflow. Your limit: ${userMax / (1024 * 1024)}MB.`,
        required_tier: isElite ? "None (max reached)" : "Elite"
      });
    }

    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Helper: delete an already-uploaded Cloudinary file, logging errors for observability
const destroyCloudinaryFile = async (file) => {
  const publicId = file.filename || file.public_id;
  if (publicId) {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'auto' }).catch((err) => {
      console.error(`[Media] Cloudinary cleanup failed for ${publicId}:`, err);
    });
  }
};

// UPLOAD MEDIA & CREATE MESSAGE
router.post('/upload', auth, preUploadSizeCheck, upload.single('file'), async (req, res) => {
  try {
    const { channelId, content, mediaType } = req.body;
    if (!req.file) return res.status(400).json({ message: "No media detected." });

    // Resolve channel and verify membership AFTER multer has parsed the body.
    // If access is denied the uploaded file is removed from Cloudinary.
    const channel = await Channel.findById(channelId);
    if (!channel) {
      await destroyCloudinaryFile(req.file);
      return res.status(404).json({ message: "Channel not found." });
    }

    const userId = req.user.id;
    const isDM = channel.type === 'dm' || channel.type === 'group_dm';
    let hasAccess = false;

    if (isDM) {
      hasAccess = channel.members.some(m => m.toString() === userId);
    } else if (channel.realm) {
      const realm = await Realm.findById(channel.realm);
      hasAccess = realm && realm.members.some(m => m.toString() === userId);
    }

    if (!hasAccess) {
      await destroyCloudinaryFile(req.file);
      return res.status(403).json({ message: "Access Denied." });
    }

    // Post-upload tier check for DM channels (they get a higher allowance).
    // req.uploadUser was set by preUploadSizeCheck.
    if (isDM) {
      const fileSize = req.file.size || 0;
      if (fileSize > DM_LIMIT) {
        await destroyCloudinaryFile(req.file);
        return res.status(413).json({ message: `Transmission overflow. DM limit: ${DM_LIMIT / (1024 * 1024)}MB.` });
      }
    }

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
