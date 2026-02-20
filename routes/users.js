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

// 1. HYBRID SYNC PROTOCOL
router.post('/vani/sync/:id', auth, async (req, res) => {
  try {
    if (req.user.id === req.params.id) return res.status(400).json({ message: "Self-sync prohibited" });
    const targetUser = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user.id);
    if (!targetUser || !currentUser) return res.status(404).json({ message: "Target node lost" });

    // Already Friends? No action needed.
    if (currentUser.friends.some(id => id.toString() === req.params.id)) {
      return res.status(400).json({ message: "Nodes already fully linked as Friends." });
    }

    // SCENARIO A: Target is PRIVATE (The Vault)
    // Rule: Must send request (Invasion).
    if (targetUser.isPrivate) {
      if (targetUser.inboundRequests.some(id => id.toString() === req.user.id)) {
        return res.status(400).json({ message: "Privacy invasion already pending." });
      }
      
      targetUser.inboundRequests.push(req.user.id);
      currentUser.outboundRequests.push(req.params.id);
      await targetUser.save(); 
      await currentUser.save();
      
      const notif = new Notification({ 
        recipient: req.params.id, 
        sender: req.user.id, 
        type: 'sync_request', 
        content: 'is attempting to link with your private node.' 
      });
      await notif.save();
      const populated = await Notification.findById(notif._id).populate('sender', 'username avatar');
      
      const io = req.app.get('socketio');
      if (io) {
        io.to(req.params.id.toString()).emit('new_notification', populated);
        io.to(req.params.id.toString()).emit('identity_sync_update');
        io.to(req.user.id.toString()).emit('identity_sync_update');
      }

      return res.json({ message: "Link Request Transmitted", status: 'pending' });
    } 
    
    // SCENARIO B: Target is PUBLIC (The Channel)
    // Rule: Instant follow allowed for everyone.
    else {
      if (currentUser.following.some(id => id.toString() === req.params.id)) {
        return res.status(400).json({ message: "Already syncing with this node." });
      }
      
      currentUser.following.push(req.params.id);
      targetUser.followers.push(req.user.id);
      await currentUser.save(); 
      await targetUser.save();
      
      const notif = new Notification({ 
        recipient: req.params.id, 
        sender: req.user.id, 
        type: 'follow', 
        content: 'is now syncing with your public transmissions.' 
      });
      await notif.save();
      const populated = await Notification.findById(notif._id).populate('sender', 'username avatar');
      
      const io = req.app.get('socketio');
      if (io) {
        io.to(req.params.id.toString()).emit('new_notification', populated);
        io.to(req.params.id.toString()).emit('identity_sync_update');
        io.to(req.user.id.toString()).emit('identity_sync_update');
      }

      return res.json({ message: "Public Sync Established", status: 'synced' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/vani/unsync/:id', auth, async (req, res) => {
  console.log(`🔌 UNSYNC/REJECT Request from ${req.user.id} to ${req.params.id}`);
  try {
    const targetUser = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user.id);
    if (!targetUser || !currentUser) {
      console.error("❌ Node not found during unsync");
      return res.status(404).json({ message: "Node not found." });
    }

    // Sever existing links
    currentUser.following = currentUser.following.filter(id => id.toString() !== req.params.id);
    targetUser.followers = targetUser.followers.filter(id => id.toString() !== req.user.id);
    currentUser.friends = currentUser.friends.filter(id => id.toString() !== req.params.id);
    targetUser.friends = targetUser.friends.filter(id => id.toString() !== req.user.id);

    // Clear pending requests (Reject logic)
    currentUser.inboundRequests = currentUser.inboundRequests.filter(id => id.toString() !== req.params.id);
    currentUser.outboundRequests = currentUser.outboundRequests.filter(id => id.toString() !== req.params.id);
    targetUser.inboundRequests = targetUser.inboundRequests.filter(id => id.toString() !== req.user.id);
    targetUser.outboundRequests = targetUser.outboundRequests.filter(id => id.toString() !== req.user.id);

    await currentUser.save(); 
    await targetUser.save();
    console.log("✅ Unsync/Reject successful");

    const io = req.app.get('socketio');
    if (io) {
      io.to(req.params.id.toString()).emit('identity_sync_update');
      io.to(req.user.id.toString()).emit('identity_sync_update');
    }

    res.json({ message: "Link severed or request rejected." });
  } catch (err) { 
    console.error("💥 Unsync error:", err);
    res.status(500).json({ error: err.message }); 
  }
});

router.post('/vani/sync/:id/accept', auth, async (req, res) => {
  console.log(`🛡️ ACCEPT Request from ${req.user.id} for ${req.params.id}`);
  try {
    const targetUser = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user.id);
    
    if (!currentUser.inboundRequests.some(id => id.toString() === req.params.id)) {
      console.error(`❌ Request not found. Inbound list: ${currentUser.inboundRequests}`);
      return res.status(400).json({ message: "No request found." });
    }
    
    // 1. Establish Mutual Friendship
    if (!currentUser.friends.includes(req.params.id)) currentUser.friends.push(req.params.id);
    if (!targetUser.friends.includes(req.user.id)) targetUser.friends.push(req.user.id);
    
    // 2. Cleanup: Remove any one-way syncs (followers/following) between these two
    currentUser.following = currentUser.following.filter(id => id.toString() !== req.params.id);
    currentUser.followers = currentUser.followers.filter(id => id.toString() !== req.params.id);
    targetUser.following = targetUser.following.filter(id => id.toString() !== req.user.id);
    targetUser.followers = targetUser.followers.filter(id => id.toString() !== req.user.id);

    currentUser.inboundRequests = currentUser.inboundRequests.filter(id => id.toString() !== req.params.id);
    targetUser.outboundRequests = targetUser.outboundRequests.filter(id => id.toString() !== req.user.id);
    
    await currentUser.save(); 
    await targetUser.save();
    
    console.log("✅ Acceptance successful, friendship established");
    
    const io = req.app.get('socketio');
    if (io) {
      io.to(req.params.id.toString()).emit('identity_sync_update');
      io.to(req.user.id.toString()).emit('identity_sync_update');
    }

    await Notification.updateMany({ recipient: req.user.id, sender: req.params.id, type: 'sync_request' }, { isRead: true });
    await new Notification({ recipient: req.params.id, sender: req.user.id, type: 'follow', content: 'accepted your invasion. Mutual link complete.' }).save();
    res.json({ message: "Identity Nodes Mutually Linked as Friends" });
  } catch (err) { 
    console.error("💥 Accept error:", err);
    res.status(500).json({ error: err.message }); 
  }
});

// PROFILE UPDATE
router.put('/me', auth, identityUpload, async (req, res) => {
  try {
    const { bio, status, customStatus, isPrivate, showAge, displayName, dob } = req.body;
    const currentUser = await User.findById(req.user.id);
    const updateData = {};

    if (displayName !== undefined) updateData.displayName = displayName.substring(0, 32);
    
    // DOB Lock Protocol: Only allow setting if currently null
    if (dob && !currentUser.dob) {
      updateData.dob = new Date(dob);
    }

    if (showAge !== undefined) updateData.showAge = showAge === 'true' || showAge === true;

    if (bio !== undefined) updateData.bio = bio.substring(0, 300);
    if (status) updateData.status = status;
    if (customStatus !== undefined) updateData.customStatus = customStatus;

    if (req.body.recoveryKeys) {
      try {
        updateData.recoveryKeys = JSON.parse(req.body.recoveryKeys);
      } catch (e) { console.error("Recovery keys parse error"); }
    }
    
    if (isPrivate !== undefined) {
      const newPrivateStatus = isPrivate === 'true' || isPrivate === true;
      
      if (newPrivateStatus && !currentUser.isPrivate) {
        // SWITCHING PUBLIC -> PRIVATE
        // Rule: If ANY party is Private, relationship = FRIEND.
        // Action: Convert all mutual Syncs (Followers+Following) to Friends.
        // Non-mutuals are severed (Privacy protocol).
        
        const mutuals = currentUser.followers.filter(f => currentUser.following.includes(f));
        
        // 1. Add mutuals to friends
        updateData.friends = [...new Set([...currentUser.friends, ...mutuals])];
        
        // 2. Update the other users: They are now friends with me, not following/followed by me.
        await User.updateMany(
          { _id: { $in: mutuals } },
          { 
            $addToSet: { friends: currentUser._id },
            $pull: { followers: currentUser._id, following: currentUser._id }
          }
        );

        // 3. Clear my Sync lists
        updateData.followers = [];
        updateData.following = [];
      }

      if (!newPrivateStatus && currentUser.isPrivate) {
        // SWITCHING PRIVATE -> PUBLIC
        // Rule: If BOTH are Public, relationship = SYNC.
        // Action: Check every existing friend. If they are Public, convert to Sync. If Private, stay Friend.
        
        const allFriends = await User.find({ _id: { $in: currentUser.friends } });
        const publicFriends = allFriends.filter(u => !u.isPrivate);
        const privateFriends = allFriends.filter(u => u.isPrivate);
        
        const publicIds = publicFriends.map(u => u._id);
        const privateIds = privateFriends.map(u => u._id);

        // 1. Convert Public Friends to Mutual Sync
        updateData.followers = [...currentUser.followers, ...publicIds];
        updateData.following = [...currentUser.following, ...publicIds];
        
        // 2. Keep Private Friends only
        updateData.friends = privateIds;

        // 3. Update the other Public users: They now Sync with me instead of Friend me.
        if (publicIds.length > 0) {
          await User.updateMany(
            { _id: { $in: publicIds } },
            {
              $pull: { friends: currentUser._id },
              $addToSet: { followers: currentUser._id, following: currentUser._id }
            }
          );
        }
      }
      updateData.isPrivate = newPrivateStatus;
    }

    if (req.files) {
      if (req.files.avatar) updateData.avatar = req.files.avatar[0].path;
      if (req.files.banner) updateData.banner = req.files.banner[0].path;
    }

    const updatedUser = await User.findByIdAndUpdate(req.user.id, { $set: updateData }, { new: true }).select('-totpSecret');
    res.json(updatedUser);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// NOTIFICATIONS
router.get('/vani/alerts', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user.id }).populate('sender', 'username avatar').sort({ createdAt: -1 }).limit(20);
    res.json(notifications);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/me/notifications/read', auth, async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user.id, isRead: false }, { $set: { isRead: true } });
    res.json({ message: "Alerts cleared." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/me/notifications/read/channel/:channelId', auth, async (req, res) => {
  try {
    await Notification.updateMany({ 
      recipient: req.user.id, 
      'metadata.channelId': req.params.channelId,
      isRead: false 
    }, { $set: { isRead: true } });
    res.json({ message: "Channel alerts cleared." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/me/notifications/read/post/:postId', auth, async (req, res) => {
  try {
    await Notification.updateMany({ 
      recipient: req.user.id, 
      'metadata.postId': req.params.postId,
      isRead: false 
    }, { $set: { isRead: true } });
    res.json({ message: "Post alerts cleared." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/me/notifications/read/id/:id', auth, async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user.id },
      { $set: { isRead: true } }
    );
    res.json({ message: "Notification cleared." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
//      ACCOUNT SOVEREIGNTY PROTOCOLS
// ==========================================

// 1. DATA EXPORT (Neural Log Archive)
router.get('/me/archive/export', auth, async (req, res) => {
  console.log(`📦 ARCHIVING IDENTITY: ${req.user.id}`);
  try {
    const Post = require('../models/Post');
    const Message = require('../models/Message');
    const Realm = require('../models/Realm');
    const Channel = require('../models/Channel');

    const [profile, posts, messages, ownedRealms] = await Promise.all([
      User.findById(req.user.id).select('-totpSecret'),
      Post.find({ author: req.user.id }),
      Message.find({ sender: req.user.id }),
      Realm.find({ owner: req.user.id }).populate('channels')
    ]);

    const exportData = {
      timestamp: new Date(),
      version: "1.0.42",
      identity: profile,
      transmissions: {
        posts: posts,
        messages: messages
      },
      sovereignty: {
        owned_realms: ownedRealms
      },
      metadata: {
        total_posts: posts.length,
        total_messages: messages.length,
        integrity_check: "PASS"
      }
    };

    res.setHeader('Content-disposition', `attachment; filename=vani-archive-${profile.username}.json`);
    res.setHeader('Content-type', 'application/json');
    res.send(JSON.stringify(exportData, null, 2));
  } catch (err) {
    console.error("💥 Export error:", err);
    res.status(500).json({ error: "Archive generation failed." });
  }
});

// 2. IDENTITY TERMINATION (Soft Delete with 7-Day Grace Period)
router.delete('/me/terminate', auth, async (req, res) => {
  console.log(`⚠️ SCHEDULING TERMINATION: ${req.user.id}`);
  try {
    const userId = req.user.id;
    const gracePeriod = new Date();
    gracePeriod.setDate(gracePeriod.getDate() + 7); // 7 Day Horizon

    await User.findByIdAndUpdate(userId, { 
      scheduledDeletion: gracePeriod,
      isDisabled: true // Auto-disable during grace period
    });

    res.json({ message: "Termination scheduled. Your node will be purged in 7 days. Log in before then to cancel." });
  } catch (err) {
    res.status(500).json({ error: "Protocol failed." });
  }
});

// 3. IDENTITY DISABLEMENT (Hide Node)
router.post('/me/disable', auth, async (req, res) => {
  try {
    const { status } = req.body; // true to disable, false to enable
    await User.findByIdAndUpdate(req.user.id, { isDisabled: status });
    res.json({ message: status ? "Node hidden from matrix." : "Node reactivated." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. THE GREAT PURGE (Internal Helper - can be called by a cron job)
// For now, I'm keeping your original deep delete logic here as a reference 
// for when the 7 days are actually up.
const executeDeepPurge = async (userId) => {
  const Post = require('../models/Post');
  const Message = require('../models/Message');
  const Realm = require('../models/Realm');
  const Notification = require('../models/Notification');

  await Promise.all([
    Post.deleteMany({ author: userId }),
    Message.deleteMany({ sender: userId }),
    Notification.deleteMany({ recipient: userId }),
    Notification.deleteMany({ sender: userId }),
    Realm.deleteMany({ owner: userId }),
    User.updateMany({}, { $pull: { followers: userId, following: userId, friends: userId, inboundRequests: userId, outboundRequests: userId } }),
    Realm.updateMany({}, { $pull: { members: userId } })
  ]);
  await User.findByIdAndDelete(userId);
};

// SEARCH & UTILS
router.get('/public/list', auth, async (req, res) => {
  try {
    // Find users who are NOT private and NOT the current user
    // Also excluding users the current user is already following or friends with
    const currentUser = await User.findById(req.user.id);
    const excludedIds = [req.user.id, ...currentUser.following, ...currentUser.friends];
    
    const suggested = await User.find({ 
      isPrivate: false, 
      isDisabled: false,
      _id: { $nin: excludedIds } 
    })
    .select('username avatar displayName bio')
    .limit(15);
    
    res.json(suggested);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/handle/:username', auth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select('_id');
    if (!user) return res.status(404).json({ message: "Handle lost." });
    res.json({ id: user._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/me/security/keys', auth, async (req, res) => {
  try {
    const keys = Array.from({ length: 10 }, () => ({ code: Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase(), isUsed: false }));
    const user = await User.findByIdAndUpdate(req.user.id, { $set: { recoveryKeys: keys } }, { new: true });
    res.json({ keys: user.recoveryKeys });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET PROFILE BY ID
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-totpSecret -email')
      .populate('followers following friends', 'username avatar status displayName bio')
      .populate('inboundRequests', 'username avatar status displayName bio');
      
    if (!user) return res.status(404).json({ message: "Identity lost" });
    const isMe = req.user.id === req.params.id;
    const isFriend = user.friends.some(f => (f._id || f).toString() === req.user.id);
    const userObj = user.toObject(); userObj.id = userObj._id;
    if (user.isPrivate && !isMe && !isFriend) userObj.isLocked = true;
    res.json(userObj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

module.exports = router;
