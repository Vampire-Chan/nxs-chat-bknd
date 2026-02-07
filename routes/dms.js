const router = require('express').Router();
const Channel = require('../models/Channel');
const User = require('../models/User');
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');

// GET My DMs (Splits active and pending)
router.get('/', auth, async (req, res) => {
  try {
    const dms = await Channel.find({ 
      type: 'dm', 
      members: req.user.id 
    }).populate('members', 'username avatar bio');

    res.json(dms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// START DM (Identity Link Request)
router.post('/', auth, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    if (req.user.id === targetUserId) return res.status(400).json({ message: "Self-link prohibited" });

    // 1. Check existing
    let dm = await Channel.findOne({
      type: 'dm',
      members: { $all: [req.user.id, targetUserId] }
    });

    if (!dm) {
      // 2. Check if target user follows current user (Privacy bypass)
      const targetUser = await User.findById(targetUserId);
      const isSynced = targetUser.following.includes(req.user.id);

      dm = new Channel({
        type: 'dm',
        members: [req.user.id, targetUserId],
        status: isSynced ? 'active' : 'pending' // If they follow us, it's auto-active
      });
      await dm.save();

      // Notify Target if pending
      if (dm.status === 'pending') {
        await new Notification({
          recipient: targetUserId,
          sender: req.user.id,
          type: 'system',
          content: 'is requesting a Private Link connection.'
        }).save();
      }
    }

    await dm.populate('members', 'username avatar bio');
    res.json(dm);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ACCEPT DM Request
router.put('/:id/accept', auth, async (req, res) => {
  try {
    const dm = await Channel.findById(req.params.id);
    if (!dm) return res.status(404).json({ message: "Link node lost" });
    
    // Ensure user is the recipient (not the one who started it)
    // For now, any member can activate.
    dm.status = 'active';
    await dm.save();
    res.json({ message: "Link Synchronized", dm });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;