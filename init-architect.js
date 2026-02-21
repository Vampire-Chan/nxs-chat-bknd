require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Realm = require('./models/Realm');
const Channel = require('./models/Channel');

const username = process.argv[2];

if (!username) {
  console.log("❌ ERROR: Provide identity handle.");
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    const user = await User.findOne({ username });
    if (!user) {
      console.log("❌ ERROR: Identity node not found.");
      process.exit(1);
    }

    // 1. Elevate User
    user.isAdmin = true;
    user.badges = [
      { type: 'developer', label: 'Yantravani Creator' },
      { type: 'architect', label: 'Prime Architect' }
    ];
    user.tier = 'elite';
    await user.save();
    console.log(`✅ Identity ${username} elevated.`);

    // 2. Initialize / Re-build Architect Nexus
    let nexus = await Realm.findOne({ isSystem: true }) || await Realm.findOne({ name: "Architect_Nexus" });
    
    if (nexus) {
      await Channel.deleteMany({ realm: nexus._id });
      // Force flags
      nexus.isSystem = true;
      nexus.isDiscoverable = false;
      // ENSURE USER IS IN MEMBERS
      if (!nexus.members.includes(user._id)) {
        nexus.members.push(user._id);
      }
    } else {
      nexus = new Realm({
        name: "Architect_Nexus",
        owner: user._id,
        isSystem: true,
        isDiscoverable: false,
        members: [user._id]
      });
    }

    // Define Structure
    const channelsToCreate = [
      // COMMAND CENTER
      { name: 'global-pulse', type: 'mod_stats' },
      { name: 'anomaly-reports', type: 'mod_reports' },
      { name: 'transmission-oversight', type: 'mod_posts' },
      { name: 'signal-tracker', type: 'mod_messages' },
      { name: 'identity-registry', type: 'mod_users' },
      
      // MODERATOR TALKS
      { name: 'hq-general', type: 'text' },
      { name: 'security-ops', type: 'text' },
      { name: 'development-sync', type: 'text' },

      // MEDIA MATRIX
      { name: 'internal-broadcasts', type: 'feed' },

      // VOICE LINKS
      { name: 'Prime Link', type: 'voice' },
      { name: 'Ops Room 1', type: 'voice' },
      { name: 'Ops Room 2', type: 'voice' },
      { name: 'Secure Line', type: 'voice' },
      { name: 'Briefing Room', type: 'voice' }
    ];

    const createdChannels = await Channel.insertMany(
      channelsToCreate.map(c => ({ ...c, realm: nexus._id }))
    );

    nexus.channels = createdChannels.map(c => c._id);
    await nexus.save();

    // Link nexus to architect
    if (!user.realms.includes(nexus._id)) {
      user.realms.push(nexus._id);
      await user.save();
    }

    console.log(`✅ Architect_Nexus fully calibrated with 4 Specialized Sectors.`);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
