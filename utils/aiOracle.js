/**
 * GEMINI AI ORACLE
 * High-Level Intelligence for Category Evolution & Post Analysis
 * Model: Gemini 1.5 Flash
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

// PLACEHOLDER: Set your GEMINI_API_KEY in .env
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

/**
 * Task: Analyze a single post for immediate sector detection.
 * Used during Post Creation.
 */
exports.analyzePost = async (caption, tags = []) => {
  if (!genAI) return { sectors: [], mood: 'neutral' };
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Analyze this social post and categorize it into 1-3 sectors (e.g. Gaming, Tech, Music, Politics, GameDev, Art).
    Caption: ${caption}
    Tags: ${tags.join(", ")}
    Return ONLY a JSON array of strings.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    // Clean JSON from response if needed
    const cleaned = text.replace(/```json|```/g, "").trim();
    return { sectors: JSON.parse(cleaned), mood: 'analyzed' };
  } catch (e) {
    console.error("AI_ORACLE_ERROR:", e);
    return { sectors: [], mood: 'fallback' };
  }
};

/**
 * Task: Batch Analysis for the 6-Hour Dream
 * Processes a collection of posts to detect sectors efficiently.
 */
exports.batchAnalyze = async (posts) => {
  if (!genAI || posts.length === 0) return [];
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const postsData = posts.map(p => ({ id: p._id, caption: p.caption, tags: p.tags }));
    
    const prompt = `Review these social transmissions and categorize each into 1-3 sectors (e.g. Gaming, Tech, Music, Politics, GameDev, Art).
    Data: ${JSON.stringify(postsData)}
    
    Return ONLY a JSON array of objects: [{"id": "post_id", "sectors": ["Sector1", "Sector2"]}]`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("AI_BATCH_ERROR:", e);
    return [];
  }
};

/**
 * Task: The "6-Hour Dream"
 * Scans all unique tags from the last 6 hours and groups them into fresh categories.
 */
exports.evolveCategories = async (allRecentTags) => {
  if (!genAI) return null;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Review this matrix of tags from the last 6 hours: ${allRecentTags.join(", ")}.
    1. Identify the top 5 "Trending Sectors".
    2. Group related tags under these sectors.
    3. Return a JSON object mapping Sector Names to Arrays of Tags.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("AI_EVOLUTION_ERROR:", e);
    return null;
  }
};
