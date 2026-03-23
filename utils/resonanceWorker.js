/**
 * RESONANCE WORKER (The 6-Hour Dreamer)
 * This background process synchronizes the Matrix every 6 hours.
 * It processes pending transmissions through the Gemini AI Oracle.
 */

const Post = require('../models/Post');
const Trend = require('../models/Trend');
const User = require('../models/User');
const aiOracle = require('./aiOracle');
const { executeDeepPurge } = require('./purgeService');

const DREAM_INTERVAL = 6 * 60 * 60 * 1000; // 6 Hours
const SIX_MONTHS = 6 * 30 * 24 * 60 * 60 * 1000;

const startResonanceWorker = () => {
  console.log("🛠️ [Resonance_Worker] Initializing background dreamer...");
  
  // Run immediately on start, then every 6 hours
  syncMatrix();
  
  setInterval(syncMatrix, DREAM_INTERVAL);
};

const syncMatrix = async () => {
  await processPendingTransmissions();
  await applyNeuralEntropy();
  await purgeInactiveNodes();
  await processScheduledTerminations();
};

const applyNeuralEntropy = async () => {
  console.log("🌀 [Resonance_Worker] Applying Neural Entropy (Cooling user interests)...");
  try {
    const users = await User.find({ frequencyMap: { $exists: true, $ne: {} } });
    const entropyFactor = 0.95; // Lose 5% of interest every 6 hours

    const updates = users.map(async (user) => {
      let changed = false;
      for (let [key, value] of user.frequencyMap) {
        const newValue = value * entropyFactor;
        if (newValue < 0.5) {
          user.frequencyMap.delete(key);
          changed = true;
        } else {
          user.frequencyMap.set(key, newValue);
          changed = true;
        }
      }
      if (changed) {
        user.markModified('frequencyMap');
        return user.save();
      }
    });

    await Promise.all(updates);
    console.log(`   ❄️  Cooled interests for ${users.length} active nodes.`);
  } catch (e) {
    console.error("❌ [Resonance_Worker] Entropy failed:", e);
  }
};

/**
 * 💀 PURGE INACTIVE NODES
 * Automatically sever identity nodes inactive for 6+ months.
 */
const purgeInactiveNodes = async () => {
  const threshold = new Date(Date.now() - SIX_MONTHS);
  console.log(`🧹 [Resonance_Worker] Checking for inactive nodes (Older than ${threshold.toLocaleDateString()})...`);
  
  try {
    const inactiveUsers = await User.find({ 
      lastSeenAt: { $lt: threshold },
      isAdmin: { $ne: true } 
    }).select('_id');
    
    if (inactiveUsers.length > 0) {
      console.log(`   💀 Initiating deep purge for ${inactiveUsers.length} stagnant identity nodes.`);
      for (const user of inactiveUsers) {
        await executeDeepPurge(user._id);
      }
    }
  } catch (e) {
    console.error("❌ [Resonance_Worker] Purge failed:", e);
  }
};

/**
 * ⚡ PROCESS SCHEDULED TERMINATIONS
 * Execute deletion for nodes that reached their 7-day grace period horizon.
 */
const processScheduledTerminations = async () => {
  console.log("🕯️ [Resonance_Worker] Checking scheduled terminations...");
  try {
    const now = new Date();
    const scheduledUsers = await User.find({
      scheduledDeletion: { $lte: now }
    }).select('_id');

    if (scheduledUsers.length > 0) {
      console.log(`   💀 Purging ${scheduledUsers.length} identity nodes who completed their grace period.`);
      for (const user of scheduledUsers) {
        await executeDeepPurge(user._id);
      }
    }
  } catch (e) {
    console.error("❌ [Resonance_Worker] Scheduled termination check failed:", e);
  }
};

const processPendingTransmissions = async () => {
  const now = new Date();
  console.log(`🌙 [Resonance_Worker] The Matrix is dreaming... (${now.toLocaleTimeString()})`);

  try {
    // 1. Find all posts that are "pending" AI analysis
    const pendingPosts = await Post.find({ 
      "aiAnalysis.mood": "pending" 
    }).limit(50); 

    if (pendingPosts.length === 0) {
      console.log("   ✨ No pending transmissions found. Matrix is in equilibrium.");
      return;
    }

    console.log(`   📡 Syncing ${pendingPosts.length} transmissions with the AI Oracle...`);

    // 2. Batch analyze with Gemini
    const analysisResults = await aiOracle.batchAnalyze(pendingPosts);

    // 3. Update the database
    const updatePromises = analysisResults.map(async (result) => {
      return Post.findByIdAndUpdate(result.id, {
        $set: {
          detectedSectors: result.sectors,
          "aiAnalysis.mood": "done",
          "aiAnalysis.confidence": 1.0
        }
      });
    });

    await Promise.all(updatePromises);

    // 4. Global Evolution (Optional: Dream of new categories based on all recent tags)
    const allTags = await Post.distinct('tags', {
      createdAt: { $gte: new Date(now.getTime() - DREAM_INTERVAL) }
    });
    
    if (allTags.length > 0) {
      const evolution = await aiOracle.evolveCategories(allTags);
      if (evolution) {
        console.log("   🌀 Matrix Evolution Detected:", Object.keys(evolution));
        
        // 1. Purge old trends
        await Trend.deleteMany({});

        // 2. Inject new dreams
        const newTrends = Object.entries(evolution).map(([sector, tags]) => ({
          name: sector,
          tags: tags,
          score: tags.length * 10,
          expiresAt: new Date(Date.now() + DREAM_INTERVAL)
        }));

        await Trend.insertMany(newTrends);
        console.log(`   ✨ [Evolution] ${newTrends.length} new sectors injected into the collective.`);
      }
    }

    console.log(`✅ [Resonance_Worker] Sync complete. ${pendingPosts.length} nodes calibrated.`);

  } catch (error) {
    console.error("❌ [Resonance_Worker] Sync Interrupted:", error);
  }
};

module.exports = { startResonanceWorker };
