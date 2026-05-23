const User = require('../models/User');

const REALM_PERMISSIONS = [
  'ADMINISTRATOR',
  'MANAGE_REALM',
  'MANAGE_ROLES',
  'MANAGE_CATEGORIES',
  'MANAGE_CHANNELS',
  'MANAGE_MESSAGES',
  'MANAGE_MEDIA',
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'CREATE_POSTS',
  'CONNECT',
  'SPEAK',
  'STREAM'
];

function normalizeId(value) {
  return value ? value.toString() : '';
}

function getRolePermissions(realm, roleId) {
  const role = (realm.roles || []).find(r => normalizeId(r._id) === normalizeId(roleId));
  return role?.permissions || [];
}

function resolveMemberPermissions(realm, userId) {
  const uid = normalizeId(userId);
  if (!uid) return new Set();

  // Realm owner has full authority in realm scope.
  if (normalizeId(realm.owner) === uid) {
    return new Set(REALM_PERMISSIONS);
  }

  const permissions = new Set();

  // Apply @everyone role first when present.
  const everyoneRole = (realm.roles || []).find(r => r.key === 'everyone');
  (everyoneRole?.permissions || []).forEach(p => permissions.add(p));

  // Apply assigned roles by ascending position.
  const roleIds = (realm.memberRoles || [])
    .filter(mr => normalizeId(mr.user) === uid)
    .map(mr => normalizeId(mr.roleId));

  const assignedRoles = (realm.roles || [])
    .filter(r => roleIds.includes(normalizeId(r._id)))
    .sort((a, b) => (a.position || 0) - (b.position || 0));

  assignedRoles.forEach(role => {
    (role.permissions || []).forEach(p => permissions.add(p));
  });

  if (permissions.has('ADMINISTRATOR')) {
    return new Set(REALM_PERMISSIONS);
  }

  return permissions;
}

async function hasRealmPermission({ realm, userId, permission }) {
  if (!realm || !userId) return false;

  const uid = normalizeId(userId);

  if (normalizeId(realm.owner) === uid) return true;

  const actor = await User.findById(uid).select('isAdmin').lean();
  if (actor?.isAdmin) return true;

  const resolved = resolveMemberPermissions(realm, uid);
  return resolved.has(permission);
}

module.exports = {
  REALM_PERMISSIONS,
  resolveMemberPermissions,
  hasRealmPermission,
  getRolePermissions
};
