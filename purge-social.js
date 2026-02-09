require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("🔥 INITIATING SOCIAL PURGE PROTOCOL...");
    
    await User.updateMany({}, { 
      $set: { 
        followers: [], 
        following: [], 
        friends: [], 
        inboundRequests: [], 
        outboundRequests: [] 
      } 
    });

    console.log("✅ SOCIAL GRAPH RESET: All links severed.");
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
