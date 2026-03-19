const router = require('express').Router();
const Channel = require('../models/Channel');
const auth = require('../middleware/auth');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'nexus-groups', resource_type: 'auto' }
});
const upload = multer({ storage: storage });

// DEBUG LOGGER
router.use((req, res, next) => {
  console.log(`📩 [DM_ROUTER] ${req.method} ${req.url}`);
  next();
});

// 1. GET ALL MY DMS (Private & Group)
router.get('/', auth, async (req, res) => {
  try {
    const dms = await Channel.find({
      type: { $in: ['dm', 'group_dm'] },
      members: req.user.id
    }).populate('members', 'username avatar status');
    res.json(dms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. INITIALIZE PRIVATE DM (1-on-1)
router.post('/', auth, async (req, res) => {
  const { targetUserId } = req.body;
  try {
    // Check if exists
    let dm = await Channel.findOne({
      type: 'dm',
      members: { $all: [req.user.id, targetUserId], $size: 2 }
    });
    if (dm) {
      const populated = await Channel.findById(dm._id).populate('members', 'username avatar status');
      return res.json(populated);
    }

    dm = new Channel({
      name: "Private_Link",
      type: 'dm',
      members: [req.user.id, targetUserId]
    });
    await dm.save();
    const populated = await Channel.findById(dm._id).populate('members', 'username avatar status');
    res.json(populated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. INITIALIZE GROUP DM (Multi-user)
router.post('/group', auth, async (req, res) => {
  const { userIds, name } = req.body; // Array of IDs
  try {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: "userIds must be a non-empty array." });
    }
    const members = [...new Set([...userIds, req.user.id])]; // Unique IDs including sender
    if (members.length > 50) return res.status(400).json({ message: "Identity limit exceeded (Max 50)." });

    const group = new Channel({
      name: name || "Group_Link",
      type: 'group_dm',
      members: members
    });

    await group.save();
    const populated = await Channel.findById(group._id).populate('members', 'username avatar status');
    res.json(populated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. UPDATE METADATA (Name, Icon, Nicknames)
router.patch('/:id/metadata', auth, upload.single('icon'), async (req, res) => {
  const userId = req.user.id || req.user._id;
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ message: "Link lost." });
    
    // SECURE MEMBER CHECK
    if (!channel.members.some(m => m.toString() === userId.toString())) {
      return res.status(403).json({ message: "Unauthorized node modification." });
    }

    const { name, nicknames } = req.body;
    
    if (name) channel.name = name;
    if (req.file) channel.icon = req.file.path;
    if (nicknames) {
      const parsedNicknames = typeof nicknames === 'string' ? JSON.parse(nicknames) : nicknames;
      channel.nicknames = { ...channel.nicknames, ...parsedNicknames };
      channel.markModified('nicknames');
    }

    await channel.save();
    const updated = await Channel.findById(channel._id).populate('members', 'username avatar status');

    console.log(`✅ [DM_ROUTER] Metadata updated for group: ${channel._id}`);

    // Broadcast update
    const io = req.app.get('socketio');
    if (io) {
      io.to(channel._id.toString()).emit('channel_metadata_update', updated);
    }

    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. SEVER LINK (Close DM)
router.delete('/:id', auth, async (req, res) => {
  const userId = req.user.id || req.user._id;
  try {
    const dm = await Channel.findById(req.params.id);
    if (!dm) return res.status(404).json({ message: "Link already severed." });
    
    // Authorization: User must be member
    if (!dm.members.some(m => m.toString() === userId.toString())) return res.status(403).json({ message: "Unauthorized." });

    await Channel.findByIdAndDelete(req.params.id);
    // Optional: Delete all messages in this link
    await require('../models/Message').deleteMany({ channel: req.params.id });
    
    res.json({ message: "Identity link closed." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
