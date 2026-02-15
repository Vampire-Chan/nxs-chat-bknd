const router = require('express').Router();
const User = require('../models/User');
const Notification = require('../models/Notification');
const jwt = require('jsonwebtoken');
const otplib = require('otplib');
const qrcode = require('qrcode');
const auth = require('../middleware/auth');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Config Cloudinary for Setup
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nexus-identities',
    resource_type: 'auto',
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp']
  }
});
const upload = multer({ storage: storage });

// Helper to get device info
const getDeviceInfo = (req) => {
  const ua = req.headers['user-agent'] || 'Unknown Identity';
  if (ua.includes('Windows')) return 'Windows PC';
  if (ua.includes('Macintosh')) return 'MacBook';
  if (ua.includes('iPhone')) return 'iPhone';
  if (ua.includes('Android')) return 'Android Device';
  return 'Unknown Terminal';
};

// 1. REGISTER
router.post('/register', async (req, res) => {
  try {
    const { username, displayName, dob } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ message: "Username already taken" });

    const secret = otplib.generateSecret();
    const newUser = new User({ 
      username, 
      displayName: displayName || username, 
      dob, 
      totpSecret: secret, 
      isVerified: false,
      isPrivate: true // Explicitly private by default
    });
    await newUser.save();

    const issuer = 'Yantravani';
    const label = `${issuer}:${username}`;
    const otpauth = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    const qrImageUrl = await qrcode.toDataURL(otpauth);

    res.status(201).json({ 
      message: "Identity created. Scan QR Code.", 
      qrCode: qrImageUrl, 
      secret: secret // Raw secret for manual entry
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. VERIFY REGISTRATION
router.post('/verify-registration', async (req, res) => {
  try {
    const { username, token } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isVerified) return res.status(400).json({ message: "User already verified" });

    const isValid = await otplib.verify({ token, secret: user.totpSecret });
    if (!isValid) return res.status(400).json({ message: "Invalid Code" });

    user.isVerified = true;
    
    // Recovery Protocol: Cancel termination if user logs in
    if (user.scheduledDeletion) {
      user.scheduledDeletion = null;
      user.isDisabled = false;
    }
    
    await user.save();

    // Create Notification
    await new Notification({
      recipient: user._id,
      type: 'login',
      content: `Initial identity established from ${getDeviceInfo(req)}`,
      metadata: { deviceName: getDeviceInfo(req) }
    }).save();

    const jwtToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(200).json({ token: jwtToken, user: { _id: user._id, id: user._id, username: user.username, isSetupComplete: user.isSetupComplete } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. PROFILE SETUP (Final Step)
router.post('/setup', auth, upload.single('avatar'), async (req, res) => {
  try {
    const { bio } = req.body;
    const updateData = { isSetupComplete: true };
    if (bio) updateData.bio = bio;
    if (req.file) updateData.avatar = req.file.path;

    const user = await User.findByIdAndUpdate(req.user.id, { $set: updateData }, { new: true }).select('-totpSecret');
    res.json({ message: "Identity Calibration Complete", user: { ...user.toObject(), id: user._id } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. LOGIN
router.post('/login', async (req, res) => {
  try {
    const { username, token } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.isVerified) return res.status(403).json({ message: "Account setup not complete." });

    const isValid = await otplib.verify({ token, secret: user.totpSecret });
    if (!isValid) return res.status(400).json({ message: "Invalid Code" });

    // Recovery Protocol
    if (user.scheduledDeletion) {
      user.scheduledDeletion = null;
      user.isDisabled = false;
      await user.save();
    }

    await new Notification({
      recipient: user._id,
      type: 'login',
      content: `Access granted via ${getDeviceInfo(req)}`,
      metadata: { deviceName: getDeviceInfo(req) }
    }).save();

    const jwtToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(200).json({ token: jwtToken, user: { _id: user._id, id: user._id, username: user.username, avatar: user.avatar, isSetupComplete: user.isSetupComplete } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
