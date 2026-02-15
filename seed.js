require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Realm = require('./models/Realm');
const Channel = require('./models/Channel');

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('🌱 Connected to MongoDB...');

    // 1. Clear existing data
    await User.deleteMany({});
    await Realm.deleteMany({});
    await Channel.deleteMany({});
    console.log('🧹 Cleared existing data.');

    // 2. Create Admin User
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password123', salt);

    const adminUser = await User.create({
      username: 'YantravaniAdmin',
      email: 'admin@Yantravani.com',
      password: hashedPassword,
      bio: 'The creator of this universe.',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=YantravaniAdmin' 
    });
    console.log('👤 Created Admin User:', adminUser.username);

    // 3. Create Global Realm
    const globalRealm = await Realm.create({
      name: 'Yantravani Global',
      icon: 'https://api.dicebear.com/7.x/identicon/svg?seed=YantravaniGlobal',
      owner: adminUser._id,
      members: [adminUser._id]
    });
    console.log('🌍 Created Realm:', globalRealm.name);

    // 4. Create Channels
    const channels = await Channel.insertMany([
      { realm: globalRealm._id, name: 'general-chat', type: 'text' },
      { realm: globalRealm._id, name: 'announcements', type: 'text' },
      { realm: globalRealm._id, name: 'art-showcase', type: 'feed' },
      { realm: globalRealm._id, name: 'memes', type: 'feed' }
    ]);
    console.log('📺 Created Channels:', channels.map(c => c.name).join(', '));

    // 5. Link Channels & Realm to User
    globalRealm.channels = channels.map(c => c._id);
    await globalRealm.save();

    adminUser.realms.push(globalRealm._id);
    await adminUser.save();

    console.log('✅ Seeding Complete!');
    process.exit(0);

  } catch (err) {
    console.error('❌ Seeding Failed:', err);
    process.exit(1);
  }
};

seedData();
