const router = require('express').Router();
const Realm = require('../models/Realm');
const User = require('../models/User');
const Channel = require('../models/Channel');
const auth = require('../middleware/auth');

// GET User's Realms
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('realms');
    res.json(user.realms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE Realm
router.post('/', auth, async (req, res) => {
  try {
    const { name, icon } = req.body;

    const newRealm = new Realm({
      name,
      icon: icon || `https://api.dicebear.com/7.x/identicon/svg?seed=${name}`,
      owner: req.user.id,
      members: [req.user.id]
    });
    const savedRealm = await newRealm.save();

    // Create default channels
    const defaultChannels = await Channel.insertMany([
      { realm: savedRealm._id, name: 'general', type: 'text' },
      { realm: savedRealm._id, name: 'feed', type: 'feed' }
    ]);

    savedRealm.channels = defaultChannels.map(c => c._id);
    await savedRealm.save();

    // Add to User
    await User.findByIdAndUpdate(req.user.id, { $push: { realms: savedRealm._id } });

    res.json(savedRealm);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// JOIN Realm
router.post('/:id/join', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Realm signature not found" });

    if (realm.members.includes(req.user.id)) {
      return res.status(400).json({ message: "Identity already synced with this realm" });
    }

    realm.members.push(req.user.id);
    await realm.save();

    // Add to User
    await User.findByIdAndUpdate(req.user.id, { $push: { realms: realm._id } });

    res.json({ message: "Identity Link Established", realm });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LEAVE Realm
router.post('/:id/leave', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Realm signature lost" });

    if (realm.owner.toString() === req.user.id) {
      return res.status(400).json({ message: "Architects must initiate a total collapse to leave (Delete)" });
    }

    realm.members = realm.members.filter(m => m.toString() !== req.user.id);
    await realm.save();

    await User.findByIdAndUpdate(req.user.id, { $pull: { realms: realm._id } });

    res.json({ message: "Link Severed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE Realm (Total Collapse)
router.delete('/:id', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Realm already collapsed" });

    if (realm.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: "Only the architect can collapse this node" });
    }

    // 1. Remove Realm from all members' lists
    await User.updateMany(
      { _id: { $in: realm.members } },
      { $pull: { realms: realm._id } }
    );

    // 2. Delete all channels in this realm
    await Channel.deleteMany({ realm: realm._id });

    // 3. Delete the realm itself
    await Realm.findByIdAndDelete(req.params.id);

    res.json({ message: "Node successfully collapsed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Specific Realm Details (with Channels and Members)
router.get('/:id', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id)
      .populate('channels')
      .populate('members', 'username avatar bio');
    res.json(realm);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE Channel in Realm
router.post('/:id/channels', auth, async (req, res) => {
  try {
    const { name, type } = req.body;
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Realm lost" });
    if (realm.owner.toString() !== req.user.id) {
      return res.status(403).json({ message: "Only the architect can create nodes" });
    }

    const newChannel = new Channel({
      realm: req.params.id,
      name,
      type
    });
    const savedChannel = await newChannel.save();

    realm.channels.push(savedChannel._id);
    await realm.save();

    res.json(savedChannel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
