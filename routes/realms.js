const router = require('express').Router();
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
    const user = await User.findById(req.user.id).populate('realms');
    res.json(user.realms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name } = req.body;
    const newRealm = new Realm({ name, owner: req.user.id, members: [req.user.id] });
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
    res.json(realm);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/channels', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    if (realm.owner.toString() !== req.user.id) return res.status(403).json({ message: "Sovereign only" });

    const { name, type } = req.body;
    const newChannel = new Channel({ realm: req.params.id, name, type });
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

router.post('/:id/invites', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    if (realm.owner.toString() !== req.user.id) return res.status(403).json({ message: "Sovereign only" });

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
    if (!realm.members.includes(req.user.id)) {
      realm.members.push(req.user.id); await realm.save();
      await User.findByIdAndUpdate(req.user.id, { $push: { realms: realm._id } });
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

module.exports = router;
