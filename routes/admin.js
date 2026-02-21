const router = require('express').Router();
const User = require('../models/User');
const Realm = require('../models/Realm');
const Message = require('../models/Message');
const Post = require('../models/Post');
const Report = require('../models/Report');
const Transaction = require('../models/Transaction');
const auth = require('../middleware/auth');

// Middleware to ensure admin/architect level access
const adminAuth = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const hasClearance = user && (user.isAdmin || user.badges?.some(b => b.type === 'architect' || b.type === 'developer'));
    if (!hasClearance) return res.status(403).json({ message: "Architect Clearance Required" });
    next();
  } catch (e) { res.status(500).json({ message: "Auth Error" }); }
};

// --- FINANCE OVERSIGHT ---
router.get('/finance/pending', auth, adminAuth, async (req, res) => {
  try {
    const txs = await Transaction.find({ status: 'pending' }).populate('user', 'username avatar');
    res.json(txs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/finance/approve/:id', auth, adminAuth, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ message: "Proof not found" });
    tx.status = 'approved';
    await tx.save();
    
    // Elevate user to Elite tier
    await User.findByIdAndUpdate(tx.user, { tier: 'elite', $push: { badges: { type: 'premium', label: 'Matrix Supporter' } } });
    
    res.json({ message: "Energy Sync Approved. Node elevated to Elite." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/finance/reject/:id', auth, adminAuth, async (req, res) => {
  try {
    await Transaction.findByIdAndUpdate(req.params.id, { status: 'rejected' });
    res.json({ message: "Proof rejected." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- GLOBAL STATS ---
router.get('/stats', auth, adminAuth, async (req, res) => {
  try {
    const [users, posts, realms] = await Promise.all([
      User.countDocuments(),
      Post.countDocuments(),
      Realm.countDocuments()
    ]);
    res.json({ users, posts, realms });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- REPORT MANAGEMENT ---
router.get('/reports', auth, adminAuth, async (req, res) => {
  try {
    const reports = await Report.find({ status: 'pending' })
      .populate('reporter', 'username avatar')
      .sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reports/:id/resolve', auth, adminAuth, async (req, res) => {
  try {
    const { action } = req.body; 
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });

    if (action === 'ban_user') {
      let userIdToBan;
      if (report.targetType === 'user') userIdToBan = report.targetId;
      else if (report.targetType === 'message') {
        const m = await Message.findById(report.targetId);
        if (m) userIdToBan = m.sender;
      } else if (report.targetType === 'post') {
        const p = await Post.findById(report.targetId);
        if (p) userIdToBan = p.author;
      }
      if (userIdToBan) await User.findByIdAndUpdate(userIdToBan, { isDisabled: true });
    } else if (action === 'delete_content') {
      if (report.targetType === 'message') await Message.findByIdAndDelete(report.targetId);
      if (report.targetType === 'post') await Post.findByIdAndDelete(report.targetId);
    }

    report.status = action === 'dismiss' ? 'dismissed' : 'resolved';
    await report.save();
    res.json({ message: "Report processed." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- USER MODERATION ---
router.get('/identities', auth, adminAuth, async (req, res) => {
  try {
    const users = await User.find().select('-totpSecret').sort({ createdAt: -1 }).limit(50);
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/identities/:id/authority', auth, adminAuth, async (req, res) => {
  try {
    const { badges, isAdmin } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { $set: { badges, isAdmin } }, { new: true });
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/identities/:id/mod-action', auth, adminAuth, async (req, res) => {
  try {
    const { action } = req.body; // 'ban', 'unban', 'shadow_ban', 'unshadow_ban'
    const update = {};
    if (action === 'ban') update.isDisabled = true;
    if (action === 'unban') update.isDisabled = false;
    if (action === 'shadow_ban') update.isShadowBanned = true;
    if (action === 'unshadow_ban') update.isShadowBanned = false;
    
    const user = await User.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    res.json({ message: `Action ${action} applied to ${user.username}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- CONTENT MODERATION (GLOBAL) ---
router.get('/messages', auth, adminAuth, async (req, res) => {
  try {
    const messages = await Message.find()
      .populate('sender', 'username avatar')
      .populate({
        path: 'channel',
        match: { type: { $in: ['text', 'announcement'] } } // Only public channels
      })
      .sort({ timestamp: -1 })
      .limit(100);
    
    // Filter out messages where channel is null (meaning it was a DM/Group or didn't match)
    const filtered = messages.filter(m => m.channel !== null);
    res.json(filtered);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/broadcasts', auth, adminAuth, async (req, res) => {
  try {
    const posts = await Post.find().populate('author', 'username avatar').sort({ createdAt: -1 }).limit(50);
    res.json(posts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/broadcasts/:id', auth, adminAuth, async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: "Transmission Purged" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/messages/:id', auth, adminAuth, async (req, res) => {
  try {
    const { content, removeAttachments } = req.body;
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: "Signal lost" });

    if (content !== undefined) msg.content = content;
    if (removeAttachments) {
      msg.mediaUrl = undefined;
      msg.mediaType = undefined;
    }

    await msg.save();
    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/messages/:id', auth, adminAuth, async (req, res) => {
  try {
    await Message.findByIdAndDelete(req.params.id);
    res.json({ message: "Signal Severed" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- REALM OVERSIGHT ---
router.get('/realms', auth, adminAuth, async (req, res) => {
  try {
    const realms = await Realm.find().populate('owner', 'username').sort({ createdAt: -1 });
    res.json(realms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/realms/:id', auth, adminAuth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (realm.isSystem) return res.status(403).json({ message: "Cannot collapse the Nexus." });
    
    await User.updateMany({ realms: realm._id }, { $pull: { realms: realm._id } });
    await Message.deleteMany({ channel: { $in: realm.channels } });
    await Realm.findByIdAndDelete(req.params.id);
    res.json({ message: "Realm Purged" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
