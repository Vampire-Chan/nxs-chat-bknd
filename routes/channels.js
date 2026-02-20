const router = require('express').Router();
const Channel = require('../models/Channel');
const Message = require('../models/Message');
const ScheduledMessage = require('../models/ScheduledMessage');
const Post = require('../models/Post');
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');

// 1. EDIT MESSAGE
router.put('/messages/:id', auth, async (req, res) => {
  try {
    const { content } = req.body;
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: "Transmission lost." });
    
    if (msg.sender.toString() !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized node modification." });
    }

    msg.content = content;
    await msg.save();

    const populated = await Message.findById(msg._id).populate('sender', 'username avatar badges tier isAdmin');

    const io = req.app.get('socketio');
    if (io) {
      io.to(msg.channel.toString()).emit('message_updated', populated);
    }

    res.json(populated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. DELETE MESSAGE
router.delete('/messages/:id', auth, async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: "Message already purged." });
    
    if (msg.sender.toString() !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized severance." });
    }

    await Message.findByIdAndDelete(req.params.id);
    res.json({ message: "Transmission erased from matrix." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. MARK AS READ
router.post('/:id/read', auth, async (req, res) => {
  try {
    const channelId = req.params.id;
    const userId = req.user.id;
    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ message: "Node lost" });
    if (!channel.lastSeen) channel.lastSeen = {};
    channel.lastSeen[userId] = new Date();
    channel.markModified('lastSeen');
    await channel.save();

    await Notification.updateMany({ recipient: userId, 'metadata.channelId': channelId, isRead: false }, { $set: { isRead: true } });

    res.json({ message: "Channel synced as read." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. MARK AS UNREAD
router.post('/:id/unread', auth, async (req, res) => {
  try {
    const channelId = req.params.id;
    const userId = req.user.id;
    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ message: "Node lost" });
    if (!channel.lastSeen) channel.lastSeen = {};
    channel.lastSeen[userId] = new Date(0);
    channel.markModified('lastSeen');
    await channel.save();
    res.json({ message: "Channel marked as unread." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. GET MESSAGES (Auto-marks as read)
router.get('/:id/messages', auth, async (req, res) => {
  try {
    const channelId = req.params.id;
    const userId = req.user.id;
    const channel = await Channel.findById(channelId);
    if (channel) {
      if (!channel.lastSeen) channel.lastSeen = {};
      channel.lastSeen[userId] = new Date();
      channel.markModified('lastSeen');
      await channel.save();

      await Notification.updateMany({ recipient: userId, 'metadata.channelId': channelId, isRead: false }, { $set: { isRead: true } });
    }
    const messages = await Message.find({ channel: channelId })
      .populate('sender', 'username avatar badges tier isAdmin')
      .sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. GET POSTS (For Feed/Reels Channels)
router.get('/:id/posts', auth, async (req, res) => {
  try {
    const posts = await Post.find({ channel: req.params.id })
      .populate('author', 'username avatar displayName showAge dob isPrivate')
      .populate('sourceRealm', 'name icon isDiscoverable')
      .populate('comments.user', 'username avatar displayName isPrivate')
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. SCHEDULE MESSAGE
router.post('/schedule', auth, async (req, res) => {
  try {
    const { channelId, content, scheduledFor, parentMessageId } = req.body;
    
    if (!content || !scheduledFor) {
      return res.status(400).json({ message: "Content and dispatch time required." });
    }

    const scheduledDate = new Date(scheduledFor);
    if (scheduledDate <= new Date()) {
      return res.status(400).json({ message: "Dispatch time must be in the future." });
    }

    const scheduled = new ScheduledMessage({
      channel: channelId,
      sender: req.user.id,
      content,
      scheduledFor: scheduledDate,
      parentMessage: parentMessageId || null
    });

    await scheduled.save();
    res.json({ message: "Signal scheduled for future dispatch.", scheduledId: scheduled._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
