/**
 * RESONANCE WORKER (The 6-Hour Dreamer)
 * This background process synchronizes the Matrix every 6 hours.
 * It processes pending transmissions through the Gemini AI Oracle.
 */

const Post = require('../models/Post');
const Trend = require('../models/Trend');
const aiOracle = require('./aiOracle');

const DREAM_INTERVAL = 6 * 60 * 60 * 1000; // 6 Hours

const startResonanceWorker = () => {
  console.log("🛠️ [Resonance_Worker] Initializing background dreamer...");
  
  // Run immediately on start, then every 6 hours
  processPendingTransmissions();
  
  setInterval(processPendingTransmissions, DREAM_INTERVAL);
};

const processPendingTransmissions = async () => {
  const now = new Date();
  console.log(`🌙 [Resonance_Worker] The Matrix is dreaming... (${now.toLocaleTimeString()})`);

  try {
    // 1. Find all posts that are "pending" AI analysis
    const pendingPosts = await Post.find({ 
      "aiAnalysis.mood": "pending" 
    }).limit(50); // Process in manageable chunks

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
        
        // 1. Purge old trends (The Matrix forgets the past)
        await Trend.deleteMany({});

        // 2. Inject new dreams
        const newTrends = Object.entries(evolution).map(([sector, tags]) => ({
          name: sector,
          tags: tags,
          score: tags.length * 10, // Simple score based on tag volume
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
