const User = require('../models/User');
const Post = require('../models/Post');
const Message = require('../models/Message');
const Realm = require('../models/Realm');
const Notification = require('../models/Notification');

/**
 * THE GREAT PURGE
 * Recursively severs an identity from the Matrix, 
 * including all transmissions, sovereignty (realms), and neural links.
 */
const executeDeepPurge = async (userId) => {
  console.log(`💀 [PURGE_PROTOCOL] Executing deep purge for: ${userId}`);
  
  try {
    await Promise.all([
      // 1. Wipe all transmissions
      Post.deleteMany({ author: userId }),
      Message.deleteMany({ sender: userId }),
      
      // 2. Wipe notifications related to this node
      Notification.deleteMany({ recipient: userId }),
      Notification.deleteMany({ sender: userId }),
      
      // 3. Dissolve sovereignty (realms owned by user)
      // Note: In a more complex setup, you might transfer ownership instead.
      Realm.deleteMany({ owner: userId }),
      
      // 4. Sever neural links (follows, friends, requests)
      User.updateMany({}, { 
        $pull: { 
          followers: userId, 
          following: userId, 
          friends: userId, 
          inboundRequests: userId, 
          outboundRequests: userId 
        } 
      }),
      
      // 5. Remove from all realms
      Realm.updateMany({}, { $pull: { members: userId } })
    ]);

    // 6. Finally, delete the identity itself
    await User.findByIdAndDelete(userId);
    
    console.log(`✅ [PURGE_PROTOCOL] Identity node ${userId} successfully dissolved into the void.`);
  } catch (error) {
    console.error(`❌ [PURGE_PROTOCOL] Failure during deep purge for ${userId}:`, error);
    throw error;
  }
};

module.exports = { executeDeepPurge };
