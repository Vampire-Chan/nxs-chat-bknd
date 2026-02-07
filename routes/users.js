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

// 1. SYNC PROTOCOL (ABSOLUTE TOP)
router.post('/nexus/sync/:id', auth, async (req, res) => {
  try {
    console.log(`🔗 [SYNC_TRIGGER] ${req.user.id} -> ${req.params.id}`);
    if (req.user.id === req.params.id) return res.status(400).json({ message: "Self-sync prohibited" });
    
    const targetUser = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user.id);
    if (!targetUser || !currentUser) return res.status(404).json({ message: "Target node lost" });

    if (currentUser.following.some(id => id.toString() === req.params.id)) {
      return res.status(400).json({ message: "Identity link already established" });
    }

    await new Notification({
      recipient: req.params.id,
      sender: req.user.id,
      type: 'sync_request',
      content: 'is requesting a mutual identity sync.'
    }).save();

    res.json({ message: "Sync Request Transmitted" });
  } catch (err) { 
    console.error(err);
    res.status(500).json({ error: err.message }); 
  }
});

router.post('/nexus/sync/:id/accept', auth, async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user.id);
    if (!targetUser || !currentUser) return res.status(404).json({ message: "Identity node lost" });

    if (!currentUser.following.some(id => id.toString() === req.params.id)) {
      currentUser.following.push(req.params.id);
      currentUser.followers.push(req.params.id);
    }
    if (!targetUser.following.some(id => id.toString() === req.user.id)) {
      targetUser.following.push(req.user.id);
      targetUser.followers.push(req.user.id);
    }
    await currentUser.save(); await targetUser.save();
    await Notification.updateMany({ recipient: req.user.id, sender: req.params.id, type: 'sync_request' }, { isRead: true });
    await new Notification({ recipient: req.params.id, sender: req.user.id, type: 'follow', content: 'has accepted your sync request. Mutual link established.' }).save();
    res.json({ message: "Mutual Sync Established" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. NOTIFICATIONS
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

// 3. UPDATES
router.put('/me', auth, identityUpload, async (req, res) => {
  try {
    const { bio, status, customStatus, isPrivate } = req.body;
    const updateData = {};
    if (bio !== undefined) updateData.bio = bio.substring(0, 300);
    if (status) updateData.status = status;
    if (customStatus !== undefined) updateData.customStatus = customStatus;
    if (isPrivate !== undefined) updateData.isPrivate = isPrivate === 'true' || isPrivate === true;
    if (req.files) {
      if (req.files.avatar) updateData.avatar = req.files.avatar[0].path;
      if (req.files.banner) updateData.banner = req.files.banner[0].path;
    }
    const updatedUser = await User.findByIdAndUpdate(req.user.id, { $set: updateData }, { new: true }).select('-totpSecret');
    const userObj = updatedUser.toObject(); userObj.id = userObj._id;
    res.json(userObj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. PUBLIC PROFILE
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-totpSecret -email').populate('followers following', 'username avatar bio status customStatus');
    if (!user) return res.status(404).json({ message: "Identity lost" });
    const isMe = req.user.id === req.params.id;
    const isSynced = user.followers.some(f => (f._id || f).toString() === req.user.id);
    const userObj = user.toObject(); userObj.id = userObj._id;
    if (user.isPrivate && !isMe && !isSynced) userObj.isLocked = true;
    res.json(userObj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// RECOVERY KEYS GENERATOR
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

module.exports = router;