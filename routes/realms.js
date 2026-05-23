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
const { hasRealmPermission, REALM_PERMISSIONS } = require('../utils/realmPermissions');

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'nexus-realms', resource_type: 'auto' }
});
const upload = multer({ storage: storage });
const realmUpload = upload.fields([{ name: 'icon', maxCount: 1 }, { name: 'banner', maxCount: 1 }]);

const ensureRealmPermission = async (realm, userId, permission) => {
  if (!realm) return false;
  return hasRealmPermission({ realm, userId, permission });
};

const INVITE_CODE_MIN_LENGTH = 4;
const INVITE_CODE_MAX_LENGTH = 24;
const RESERVED_INVITE_CODES = new Set(['JOIN', 'INVITE', 'CREATE', 'DELETE', 'ADMIN', 'SYSTEM', 'API']);

const normalizeInviteCode = (code) => String(code || '').trim().toUpperCase();

const isValidInviteCode = (code) => {
  if (!code) return false;
  if (code.length < INVITE_CODE_MIN_LENGTH || code.length > INVITE_CODE_MAX_LENGTH) return false;
  return /^[A-Z0-9_-]+$/.test(code);
};

const buildInviteUrl = (code) => `/app/join/${code}`;

const formatInvite = (invite) => {
  if (!invite) return null;
  return {
    code: invite.code,
    uses: invite.uses,
    maxUses: invite.maxUses,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
    urlPath: buildInviteUrl(invite.code)
  };
};

const generateUniqueInviteCode = async () => {
  for (let i = 0; i < 8; i += 1) {
    const candidate = crypto.randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, '').substring(0, 8).toUpperCase();
    if (!candidate) continue;
    const exists = await Invite.exists({ code: candidate });
    if (!exists) return candidate;
  }

  throw new Error('INVITE_CODE_GENERATION_FAILED');
};

// 1. UPDATE REALM (Robust Calibration)
router.put('/:id', auth, realmUpload, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    const allowed = await ensureRealmPermission(realm, req.user.id, 'MANAGE_REALM');
    if (!allowed) return res.status(403).json({ message: "Insufficient permissions" });

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
    const defaultEveryoneRole = {
      name: '@everyone',
      key: 'everyone',
      isSystem: true,
      color: '#7f8ea3',
      permissions: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'CREATE_POSTS', 'CONNECT', 'SPEAK', 'STREAM'],
      position: 0
    };

    const adminRole = {
      name: 'Server Admin',
      key: 'server_admin',
      isSystem: true,
      color: '#f59e0b',
      permissions: ['ADMINISTRATOR'],
      position: 100
    };

    const newRealm = new Realm({
      name: name.trim(),
      owner: req.user.id,
      members: [req.user.id],
      roles: [defaultEveryoneRole, adminRole]
    });
    const saved = await newRealm.save();

    const ownerAdminRole = (saved.roles || []).find(r => r.key === 'server_admin');
    if (ownerAdminRole) {
      saved.memberRoles = [{ user: req.user.id, roleId: ownerAdminRole._id.toString() }];
    }

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
    const canManageChannels = await ensureRealmPermission(realm, req.user.id, 'MANAGE_CHANNELS');
    if (!canManageChannels) return res.status(403).json({ message: "Insufficient permissions" });

    const { name, type, parentCategory, position, topic, nsfw } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) return res.status(400).json({ message: "Channel name is required." });
    if (name.trim().length > 48) return res.status(400).json({ message: "Channel name too long (max 48 chars)." });
    const allowedTypes = ['category', 'text', 'voice', 'media', 'gallery', 'matrix', 'feed', 'reels', 'announcement'];
    if (!type || !allowedTypes.includes(type)) return res.status(400).json({ message: `Invalid channel type. Allowed: ${allowedTypes.join(', ')}` });

    if (parentCategory) {
      const parent = await Channel.findById(parentCategory);
      if (!parent || parent.realm?.toString() !== req.params.id || parent.type !== 'category') {
        return res.status(400).json({ message: 'Invalid parent category.' });
      }
    }

    const newChannel = new Channel({
      realm: req.params.id,
      name: name.trim(),
      type,
      parentCategory: parentCategory || null,
      position: typeof position === 'number' ? position : 0,
      topic: typeof topic === 'string' ? topic.substring(0, 512) : '',
      nsfw: nsfw === true || nsfw === 'true'
    });
    const saved = await newChannel.save();
    realm.channels.push(saved._id);
    await realm.save();
    res.json(saved);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/categories', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: 'Node lost' });
    const canManageCategories = await ensureRealmPermission(realm, req.user.id, 'MANAGE_CATEGORIES');
    if (!canManageCategories) return res.status(403).json({ message: 'Insufficient permissions' });

    const { name, position } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ message: 'Category name is required.' });
    }

    const category = await Channel.create({
      realm: req.params.id,
      name: name.trim(),
      type: 'category',
      position: typeof position === 'number' ? position : 0
    });

    realm.channels.push(category._id);
    await realm.save();
    res.json(category);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/roles', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    const canManageRoles = await ensureRealmPermission(realm, req.user.id, 'MANAGE_ROLES');
    if (!canManageRoles) return res.status(403).json({ message: "Insufficient permissions" });

    const { name, color, permissions } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Role name is required.' });
    }

    const sanitizedPermissions = Array.isArray(permissions)
      ? permissions.filter(p => REALM_PERMISSIONS.includes(p))
      : [];

    const nextPosition = (realm.roles || []).reduce((max, r) => Math.max(max, r.position || 0), 0) + 1;
    realm.roles.push({ name: name.trim(), color, permissions: sanitizedPermissions, position: nextPosition });
    await realm.save();
    res.json(realm.roles);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// UPDATE ROLE PERMISSIONS / METADATA
router.patch('/:id/roles/:roleId', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: 'Node lost' });
    const canManageRoles = await ensureRealmPermission(realm, req.user.id, 'MANAGE_ROLES');
    if (!canManageRoles) return res.status(403).json({ message: 'Insufficient permissions' });

    const role = (realm.roles || []).find(r => r._id.toString() === req.params.roleId);
    if (!role) return res.status(404).json({ message: 'Role not found.' });

    const { name, color, permissions } = req.body;

    if (typeof name === 'string' && name.trim()) {
      // Prevent renaming locked system roles, but still allow permission updates.
      if (!role.isSystem) {
        role.name = name.trim().slice(0, 64);
      }
    }

    if (typeof color === 'string' && color.trim()) {
      role.color = color.trim().slice(0, 32);
    }

    if (Array.isArray(permissions)) {
      role.permissions = permissions.filter((p) => REALM_PERMISSIONS.includes(p));
    }

    await realm.save();
    res.json({ roles: realm.roles });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ASSIGN OR CLEAR MEMBER ROLE
router.post('/:id/members/:userId/role', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: "Node lost" });
    const canManageRoles = await ensureRealmPermission(realm, req.user.id, 'MANAGE_ROLES');
    if (!canManageRoles) return res.status(403).json({ message: "Insufficient permissions" });

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
    const canManageRoles = await ensureRealmPermission(realm, req.user.id, 'MANAGE_ROLES');
    if (!canManageRoles) return res.status(403).json({ message: "Insufficient permissions" });

    const roleId = req.params.roleId;
    const targetRole = (realm.roles || []).find(r => r._id.toString() === roleId);
    if (targetRole?.isSystem) {
      return res.status(400).json({ message: 'System roles cannot be deleted.' });
    }
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
    if (!realm) return res.status(404).json({ message: 'Node lost' });

    // SYSTEM REALM SECURITY
    if (realm.isSystem) {
      const user = await User.findById(req.user.id);
      if (!user.isAdmin) return res.status(403).json({ message: 'The Nexus is closed to external invites.' });
    }

    const canManageRealm = await ensureRealmPermission(realm, req.user.id, 'MANAGE_REALM');
    if (!canManageRealm) return res.status(403).json({ message: 'Insufficient permissions' });

    const maxUsesInput = Number(req.body.maxUses ?? 0);
    const maxUses = Number.isFinite(maxUsesInput) && maxUsesInput > 0 ? Math.min(Math.floor(maxUsesInput), 1000) : 0;

    const expiresInHoursInput = Number(req.body.expiresInHours ?? 0);
    const expiresInHours = Number.isFinite(expiresInHoursInput) && expiresInHoursInput > 0
      ? Math.min(expiresInHoursInput, 24 * 30)
      : 0;

    let expiresAt = null;
    if (req.body.expiresAt) {
      const explicitExpiry = new Date(req.body.expiresAt);
      if (Number.isNaN(explicitExpiry.getTime())) {
        return res.status(400).json({ message: 'Invalid expiresAt date.' });
      }
      if (explicitExpiry <= new Date()) {
        return res.status(400).json({ message: 'Invite expiry must be in the future.' });
      }
      expiresAt = explicitExpiry;
    } else if (expiresInHours > 0) {
      expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    }

    const requestedCodeInput = typeof req.body.code === 'string' ? req.body.code : '';
    const requestedCode = normalizeInviteCode(requestedCodeInput);

    if (requestedCode) {
      if (!isValidInviteCode(requestedCode)) {
        return res.status(400).json({
          message: `Invite code must be ${INVITE_CODE_MIN_LENGTH}-${INVITE_CODE_MAX_LENGTH} chars and use only letters, numbers, _ or -.`
        });
      }
      if (RESERVED_INVITE_CODES.has(requestedCode)) {
        return res.status(400).json({ message: 'This invite code is reserved.' });
      }
      const existingInvite = await Invite.exists({ code: requestedCode });
      if (existingInvite) {
        return res.status(409).json({ message: 'Invite code already in use.' });
      }
    }

    let invite = null;
    let candidateCode = requestedCode || await generateUniqueInviteCode();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        invite = await Invite.create({
          code: candidateCode,
          realm: req.params.id,
          inviter: req.user.id,
          maxUses,
          expiresAt
        });
        break;
      } catch (createErr) {
        if (createErr?.code === 11000) {
          if (requestedCode) {
            return res.status(409).json({ message: 'Invite code already in use.' });
          }
          candidateCode = await generateUniqueInviteCode();
          continue;
        }
        throw createErr;
      }
    }

    if (!invite) {
      return res.status(500).json({ message: 'Unable to create invite right now. Please retry.' });
    }

    res.json({ ...formatInvite(invite) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/invites', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: 'Node lost' });

    const canManageRealm = await ensureRealmPermission(realm, req.user.id, 'MANAGE_REALM');
    if (!canManageRealm) return res.status(403).json({ message: 'Insufficient permissions' });

    const invites = await Invite.find({ realm: req.params.id })
      .populate('inviter', 'username avatar')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(invites.map((invite) => ({
      ...formatInvite(invite),
      inviter: invite.inviter
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/invites/:code', auth, async (req, res) => {
  try {
    const realm = await Realm.findById(req.params.id);
    if (!realm) return res.status(404).json({ message: 'Node lost' });

    const canManageRealm = await ensureRealmPermission(realm, req.user.id, 'MANAGE_REALM');
    if (!canManageRealm) return res.status(403).json({ message: 'Insufficient permissions' });

    const code = normalizeInviteCode(req.params.code);
    const deleted = await Invite.findOneAndDelete({ realm: req.params.id, code });
    if (!deleted) return res.status(404).json({ message: 'Invite not found.' });

    res.json({ message: 'Invite revoked.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/join/:code', auth, async (req, res) => {
  try {
    const code = normalizeInviteCode(req.params.code);
    const invite = await Invite.findOne({ code });
    if (!invite) return res.status(404).json({ message: 'Invalid Code' });

    const now = new Date();
    if (invite.expiresAt && invite.expiresAt <= now) {
      return res.status(400).json({ message: 'Invite link has expired.' });
    }
    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      return res.status(400).json({ message: 'Invite link has reached max uses.' });
    }

    const realm = await Realm.findById(invite.realm);
    if (!realm) return res.status(404).json({ message: 'Realm no longer exists.' });

    const alreadyMember = realm.members.some(m => m.toString() === req.user.id);
    if (!alreadyMember) {
      const updated = await Invite.findOneAndUpdate(
        {
          _id: invite._id,
          $and: [
            { $or: [{ maxUses: 0 }, { $expr: { $lt: ['$uses', '$maxUses'] } }] },
            { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }
          ]
        },
        { $inc: { uses: 1 } },
        { new: true }
      );

      if (!updated) {
        return res.status(400).json({ message: 'Invite is no longer valid.' });
      }

      realm.members.push(req.user.id);
      await realm.save();
      await User.findByIdAndUpdate(req.user.id, { $addToSet: { realms: realm._id } });
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
