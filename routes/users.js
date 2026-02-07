const router = require('express').Router();
const User = require('../models/User');
const Notification = require('../models/Notification');
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
  params: { folder: 'nexus-identities', resource_type: 'auto', allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp'] }
});

const upload = multer({ storage: storage });
const identityUpload = upload.fields([{ name: 'avatar', maxCount: 1 }, { name: 'banner', maxCount: 1 }]);

// 1. THE PARALLEL SYNC ENGINE
router.post('/nexus/sync/:id', auth, async (req, res) => {
  try {
    if (req.user.id === req.params.id) return res.status(400).json({ message: "Self-sync prohibited" });
    
    const targetUser = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user.id);
    if (!targetUser || !currentUser) return res.status(404).json({ message: "Target node lost" });

    // 1. Check if already Friends (Highest Tier)
    if (currentUser.friends.some(id => id.toString() === req.params.id)) {
      return res.status(400).json({ message: "Identity nodes already fully synced." });
    }

    // 2. LOGIC SPLIT
    if (targetUser.isPrivate) {
      // TARGET IS PRIVATE: Always requires a Request (Friend System)
      if (targetUser.inboundRequests.some(id => id.toString() === req.user.id)) {
        return res.status(400).json({ message: "Link request already pending." });
      }
      targetUser.inboundRequests.push(req.user.id);
      currentUser.outboundRequests.push(req.params.id);
      await targetUser.save(); await currentUser.save();

      await new Notification({
        recipient: req.params.id,
        sender: req.user.id,
        type: 'sync_request',
        content: 'is requesting a mutual identity link.'
      }).save();

      return res.json({ message: "Secure Link Request Transmitted", status: 'pending' });
    } else {
      // TARGET IS PUBLIC: Instant Follow (Public Space)
      if (currentUser.following.some(id => id.toString() === req.params.id)) {
        return res.status(400).json({ message: "Already following this public node." });
      }
      currentUser.following.push(req.params.id);
      targetUser.followers.push(req.user.id);
      await currentUser.save(); await targetUser.save();

      await new Notification({
        recipient: req.params.id,
        sender: req.user.id,
        type: 'follow',
        content: 'is now following your public node.'
      }).save();

      return res.json({ message: "Public Sync Established", status: 'synced' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/nexus/sync/:id/accept', auth, async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id); // Requester
    const currentUser = await User.findById(req.user.id); // Accepter
    
    // Validate
    if (!currentUser.inboundRequests.some(id => id.toString() === req.params.id)) {
      return res.status(400).json({ message: "No pending request found." });
    }

    // Establish Mutual "Friend" Bond (Offline Layer)
    currentUser.friends.push(req.params.id);
    targetUser.friends.push(req.user.id);

    // Clean up Requests
    currentUser.inboundRequests = currentUser.inboundRequests.filter(id => id.toString() !== req.params.id);
    targetUser.outboundRequests = targetUser.outboundRequests.filter(id => id.toString() !== req.user.id);

    await currentUser.save(); await targetUser.save();

    await Notification.updateMany({ recipient: req.user.id, sender: req.params.id, type: 'sync_request' }, { isRead: true });
    await new Notification({
      recipient: req.params.id,
      sender: req.user.id,
      type: 'follow',
      content: 'has accepted your link. Mutual sync complete.'
    }).save();

    res.json({ message: "Identity Nodes Mutually Linked" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET PUBLIC PROFILE (Ghost Logic)
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-totpSecret -email')
      .populate('followers following friends', 'username avatar status');
    
    if (!user) return res.status(404).json({ message: "Identity lost" });
    
    const isMe = req.user.id === req.params.id;
    const isFriend = user.friends.some(f => (f._id || f).toString() === req.user.id);
    
    const userObj = user.toObject();
    userObj.id = userObj._id;
    
    // THE GHOST PROTOCOL: 
    // If you are private, people can follow you, but they can't see your matrix 
    // unless you accept them as a Friend.
    if (user.isPrivate && !isMe && !isFriend) {
      userObj.isLocked = true;
    }

    res.json(userObj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// REST OF UPDATES...
router.put('/me', auth, identityUpload, async (req, res) => {
  try {
    const { bio, status, customStatus, isPrivate, vanityHandle } = req.body;
    const updateData = {};
    if (bio !== undefined) updateData.bio = bio.substring(0, 300);
    if (status) updateData.status = status;
    if (customStatus !== undefined) updateData.customStatus = customStatus;
    if (isPrivate !== undefined) updateData.isPrivate = isPrivate === 'true' || isPrivate === true;
    if (vanityHandle !== undefined) updateData.vanityHandle = vanityHandle.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    
    if (req.files) {
      if (req.files.avatar) updateData.avatar = req.files.avatar[0].path;
      if (req.files.banner) updateData.banner = req.files.banner[0].path;
    }
    const updatedUser = await User.findByIdAndUpdate(req.user.id, { $set: updateData }, { new: true }).select('-totpSecret');
    const userObj = updatedUser.toObject(); userObj.id = userObj._id;
    res.json(userObj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/nexus/alerts', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user.id }).populate('sender', 'username avatar').sort({ createdAt: -1 }).limit(20);
    res.json(notifications);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/me/notifications/read', auth, async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user.id, isRead: false }, { isRead: true });
    res.json({ message: "Notifications cleared" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/me/security/keys', auth, async (req, res) => {
  try {
    const keys = Array.from({ length: 10 }, () => ({
      code: Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      isUsed: false
    }));
    const user = await User.findByIdAndUpdate(req.user.id, { $set: { recoveryKeys: keys } }, { new: true });
    res.json({ keys: user.recoveryKeys });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/handle/:username', auth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select('_id');
    if (!user) return res.status(404).json({ message: "Identity handle not found." });
    res.json({ id: user._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;