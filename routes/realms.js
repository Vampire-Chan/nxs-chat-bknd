const router = require('express').Router();
const mongoose = require('mongoose');
const Realm = require('../models/Realm');
const User = require('../models/User');
const Channel = require('../models/Channel');
const Invite = require('../models/Invite');
const auth = require('../middleware/auth');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const crypto = require('crypto');

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'nexus-realms', resource_type: 'auto' }
});
const upload = multer({ storage: storage });
const realmUpload = upload.fields([{ name: 'icon', maxCount: 1 }, { name: 'banner', maxCount: 1 }]);

// 1. UPDATE REALM (Robust Calibration)
router.put('/:id', auth, realmUpload, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    if (realm.owner.toString() !== req.user.id) return res.status(403).json({ message: "Sovereign only" });

    const { name, vanityHandle } = req.body;
    if (name) realm.name = name;
    
    if (vanityHandle !== undefined) {
      const slug = vanityHandle.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (slug && slug !== realm.vanityHandle) {
        // Check if taken
        const existing = await Realm.findOne({ vanityHandle: slug });
        if (existing) return res.status(400).json({ message: "Vanity signature already claimed by another node." });
        realm.vanityHandle = slug;
      } else if (!slug) {
        realm.vanityHandle = undefined; // Clear it
      }
    }

    if (req.files) {
      if (req.files.icon) realm.icon = req.files.icon[0].path;
      if (req.files.banner) realm.banner = req.files.banner[0].path;
    }

    await realm.save();
    res.json(realm);
  } catch (err) { 
    console.error(err);
    res.status(500).json({ error: err.message }); 
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const realms = await Realm.find({ 
      members: new mongoose.Types.ObjectId(req.user.id) 
    });
    res.json(realms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) return res.status(400).json({ message: "Realm name is required." });
    if (name.trim().length > 64) return res.status(400).json({ message: "Realm name too long (max 64 chars)." });
    const newRealm = new Realm({ name: name.trim(), owner: req.user.id, members: [req.user.id] });
    const saved = await newRealm.save();
    const defaultChannels = await Channel.insertMany([
      { realm: saved._id, name: 'broadcasts', type: 'announcement' },
      { realm: saved._id, name: 'chat-node', type: 'text' }
    ]);
    saved.channels = defaultChannels.map(c => c._id);
    await saved.save();
    await User.findByIdAndUpdate(req.user.id, { $push: { realms: saved._id } });
    res.json(saved);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id).populate('channels members').populate('roles');
    if (!realm) return res.status(404).json({ message: "Node lost" });

    // IDOR Fix: Ensure user is a member of the realm to view it
    const isMember = realm.members.some(member => member._id.toString() === req.user.id);
    if (!isMember) {
      return res.status(403).json({ message: "Access denied." });
    }

    res.json(realm);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/channels', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    if (realm.owner.toString() !== req.user.id) return res.status(403).json({ message: "Sovereign only" });

    const { name, type } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) return res.status(400).json({ message: "Channel name is required." });
    if (name.trim().length > 48) return res.status(400).json({ message: "Channel name too long (max 48 chars)." });
    const allowedTypes = ['text', 'voice', 'feed', 'reels', 'announcement'];
    if (!type || !allowedTypes.includes(type)) return res.status(400).json({ message: `Invalid channel type. Allowed: ${allowedTypes.join(', ')}` });
    const newChannel = new Channel({ realm: req.params.id, name: name.trim(), type });
    const saved = await newChannel.save();
    realm.channels.push(saved._id);
    await realm.save();
    res.json(saved);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/roles', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    if (realm.owner.toString() !== req.user.id) return res.status(403).json({ message: "Sovereign only" });

    const { name, color, permissions } = req.body;
    realm.roles.push({ name, color, permissions });
    await realm.save();
    res.json(realm.roles);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ASSIGN OR CLEAR MEMBER ROLE
router.post('/:id/members/:userId/role', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    if (realm.owner.toString() !== req.user.id) return res.status(403).json({ message: "Sovereign only" });

    const targetUserId = req.params.userId;
    const { roleId } = req.body;

    if (!realm.members.some(m => m.toString() === targetUserId)) {
      return res.status(400).json({ message: "Target user is not part of this realm." });
    }

    // Remove existing mapping first
    realm.memberRoles = (realm.memberRoles || []).filter(mr => mr.user.toString() !== targetUserId);

    // Empty roleId means clear role assignment
    if (roleId) {
      const roleExists = realm.roles.some(r => r._id.toString() === roleId);
      if (!roleExists) return res.status(404).json({ message: "Role not found." });
      realm.memberRoles.push({ user: targetUserId, roleId });
    }

    await realm.save();
    res.json({ memberRoles: realm.memberRoles });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE ROLE
router.delete('/:id/roles/:roleId', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    if (realm.owner.toString() !== req.user.id) return res.status(403).json({ message: "Sovereign only" });

    const roleId = req.params.roleId;
    const prevCount = realm.roles.length;
    realm.roles = realm.roles.filter(r => r._id.toString() !== roleId);
    if (realm.roles.length === prevCount) {
      return res.status(404).json({ message: "Role not found." });
    }

    // Cleanup member role mappings pointing to deleted role
    realm.memberRoles = (realm.memberRoles || []).filter(mr => mr.roleId !== roleId);

    await realm.save();
    res.json({ roles: realm.roles, memberRoles: realm.memberRoles });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/invites', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    
    // SYSTEM REALM SECURITY
    if (realm.isSystem) {
      const user = await User.findById(req.user.id);
      if (!user.isAdmin) return res.status(403).json({ message: "The Nexus is closed to external invites." });
    }

    if (realm.owner.toString() !== req.user.id && !req.user.isAdmin) return res.status(403).json({ message: "Sovereign only" });

    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const invite = new Invite({ code, realm: req.params.id, inviter: req.user.id });
    await invite.save();
    res.json({ code });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/join/:code', auth, async (req, res) => {
  try {
    const invite = await Invite.findOne({ code: req.params.code });
    if (!invite) return res.status(404).json({ message: "Invalid Code" });
    const realm = await Realm.findById(invite.realm);
    if (!realm) return res.status(404).json({ message: "Realm no longer exists." });
    if (!realm.members.some(m => m.toString() === req.user.id)) {
      realm.members.push(req.user.id); await realm.save();
      await User.findByIdAndUpdate(req.user.id, { $push: { realms: realm._id } });
    }
    res.json(realm);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// JOIN REALM BY ID (Client compatibility)
router.post('/:id/join', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Realm no longer exists." });
    if (!realm.members.some(m => m.toString() === req.user.id)) {
      realm.members.push(req.user.id);
      await realm.save();
      await User.findByIdAndUpdate(req.user.id, { $addToSet: { realms: realm._id } });
    }
    res.json(realm);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// LOOKUP BY VANITY
router.get('/handle/:vanity', auth, async (req, res) => {
  try {
    const realm = await Realm.findOne({ vanityHandle: req.params.vanity });
    if (!realm) return res.status(404).json({ message: "Realm handle not found." });
    res.json(realm);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE REALM
router.delete('/:id', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    if (realm.owner.toString() !== req.user.id) return res.status(403).json({ message: "Sovereign only" });
    if (realm.isSystem) return res.status(403).json({ message: "The Nexus cannot be collapsed." });

    // Remove from all users
    await User.updateMany({ realms: realm._id }, { $pull: { realms: realm._id } });
    // Delete channels
    await Channel.deleteMany({ realm: realm._id });
    // Delete realm
    await Realm.findByIdAndDelete(req.params.id);
    
    res.json({ message: "Sovereignty Purge Complete." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// LEAVE REALM
router.post('/:id/leave', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    if (realm.owner.toString() === req.user.id) return res.status(400).json({ message: "Sovereigns cannot sever their own link. Use Purge instead." });

    realm.members = realm.members.filter(m => m.toString() !== req.user.id);
    await realm.save();
    
    await User.findByIdAndUpdate(req.user.id, { $pull: { realms: realm._id } });
    res.json({ message: "Link severed." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
