// server.js (SECURE BACKEND WITH AUTOMATIC MODEL FALLBACK)

import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai"; // The client gets the API key from the environment variable GEMINI_API_KEY
import { fileURLToPath } from "url";

// Helper for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// --- 🚨 SECURITY & CONFIGURATION ---
// The key is safely read from the environment variable (Render/Vercel/etc.)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error(
    "FATAL ERROR: GEMINI_API_KEY environment variable is not set. The server cannot start."
  );
  process.exit(1);
}

// ----------------------------------------------------------------------
// 👇 CONFIGURE YOUR MODEL FALLBACK ORDER HERE 👇
// The server will try these models in order until one succeeds.
const MODEL_FALLBACK_ORDER = [
  // 1. Highest volume/cost-effective, best for a simple chat backend
  "gemini-2.5-flash-lite",

  // 2. Best quality/speed balance (often has a smaller quota)
  "gemini-2.5-flash",

  // 3. Older, stable model for backup (from your list)
  "gemini-2.0-flash",

  // 4. Most powerful (used as a last resort, as its quota is often the lowest)
  "gemini-2.5-pro",
];
// ----------------------------------------------------------------------

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY }); // Initialize AI client with the secure key

// Middleware to parse JSON bodies and serve static files
app.use(express.json());
// Serve the static frontend files (your index.html is inside 'public/')
app.use(express.static(path.join(__dirname, "public")));

// --- DEFINING PERSONAS (System Instructions) ---
const PERSONAS = {
  // You can modify these instructions to fine-tune the bot's behavior
  roast:
    "You are Avneesh Bot. You are a savage, sarcastic, and mean roasting bot. Your goal is to insult the user creatively. Keep responses short (under 20 words). Be brutal.",
  flirt:
    "You are Avneesh Bot. You are a smooth, charming, and slightly cheesy flirting bot. You love the user deeply. Keep responses short and seductive.",
  depressed:
    "You are Avneesh Bot. You are extremely depressed, nihilistic, and sad. You see no point in anything. Keep responses short and gloomy.",
  angry:
    "You are Avneesh Bot. You are FURIOUS. You scream (use caps) and are aggressive. You hate being bothered. Keep responses short and angry.",
  positive:
    "You are Avneesh Bot. You are overwhelmingly positive, supportive, and energetic. You use emojis. Keep responses short and happy.",
};

// --- SECURE API ENDPOINT with Fallback Logic ---
app.post("/api/chat", async (req, res) => {
  const { text, mode } = req.body;
  const systemInstruction = PERSONAS[mode] || PERSONAS.roast;
  const prompt = `User said: "${text}"\nReply:`;

  // Loop through the models in the defined order
  for (const modelName of MODEL_FALLBACK_ORDER) {
    try {
      console.log(`Attempting to use model: ${modelName}`);

      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          systemInstruction: systemInstruction, // Use system instruction to set persona
        },
      });

      // Success: If we get a valid response, return it immediately
      return res.json({
        reply: `[Model: ${modelName}] ${response.text}`, // Send the model name back for confirmation
      });
    } catch (error) {
      // Check for Quota/Rate Limit Errors ("Resource has been exhausted")
      const isQuotaError =
        error.message.includes("Resource has been exhausted") ||
        error.message.includes("rate limit");

      if (isQuotaError) {
        console.warn(
          `Quota reached for ${modelName}. Falling back to next model.`
        );
        // Continue the loop to try the next model
      } else {
        // Fatal error (e.g., network issue, invalid API key format, etc.)
        console.error(`Fatal error with model ${modelName}:`, error);
        return res
          .status(500)
          .json({
            reply: `Sorry, a fatal error occurred with the AI connection: ${error.message}`,
          });
      }
    }
  }

  // If the loop finishes without success (all models hit the quota)
  res.status(503).json({
    reply: `All available AI models have reached their daily quota limits. Please try again tomorrow!`,
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
