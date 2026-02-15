require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const username = process.argv[2];

if (!username) {
  console.log("❌ ERROR: Provide identity handle. Usage: node init-architect.js <username>");
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    const user = await User.findOne({ username });
    if (!user) {
      console.log("❌ ERROR: Identity node not found in database.");
      process.exit(1);
    }

    user.isAdmin = true;
    user.badges = [
      { type: 'developer', label: 'Yantravani Creator' },
      { type: 'architect', label: 'Prime Architect' }
    ];
    user.tier = 'elite';

    await user.save();
    console.log(`✅ SUCCESS: Identity ${username} elevated to Prime Architect status.`);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
