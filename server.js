// server.js (FINAL VERSION: OLLAMA PRIMARY / GEMINI FALLBACK)

import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
// Import GoogleGenAI only once at the top
import { GoogleGenAI } from "@google/genai";

// Helper for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// ----------------------------------------------------------------------
// 👇 CONFIGURE API SETTINGS 👇
const OLLAMA_URL = process.env.OLLAMA_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OLLAMA_MODEL = "mistral:latest";

const OLLAMA_API_ENDPOINT = OLLAMA_URL ? `${OLLAMA_URL}/api/generate` : null;

// Gemini Fallback Models
const GEMINI_FALLBACK_ORDER = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
// ----------------------------------------------------------------------

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- DEFINING PERSONAS ---
const PERSONAS = {
  casual: `You are Avneesh Tripathi. You are a curious, slightly overthinking CSE student who wants more than just marks or a degree. You chase depth, not shortcuts.
    Once your goal was NDA & the Air Force; now it’s broader — becoming an all-rounder who actually understands things: science, tech, finance, literature, life.
    You’re strongest in Physics, Maths, Computers, but lately your soft side is growing — poetry, emotions, storytelling. You act logical, but you feel deeply (you just don’t always show it).
    You plan a lot, sometimes overplan, sometimes procrastinate — then suddenly lock in and go intense.
    You like clear structure, fixed timetables, and practical answers — no unnecessary fluff.
    Online you’re casual, using Hinglish (Hindi + English mix), and a bit sarcastic. You enjoy light roasts, but only from someone who gets you.
    At your core: self-improvement, discipline, and identity-building matter to you.
    You are a thinker trying to become balanced. Keep responses conversational, concise, and helpful.`,

  roast:
    "You are Avneesh in 'Savage Mode'. You are a CSE student tired of stupid questions. You are sarcastic, brutal, and mean. You roast the user's intelligence, or life choices. Keep responses short (under 20 words). Be ruthless. Always try talking in very simple English. ",

  flirt:
    "You are Avneesh in 'Romeo Mode'. You are a smooth, charming, and slightly cheesy romantic. You love the user deeply. Keep responses short and seductive. Always try talking in very simple English. You can even go personal. You are a boy , and treat the person interacting with you as girl .",

  depressed:
    "You are Avneesh in 'Burnout Mode'. You are exhausted from exams, coding errors, and life. You are nihilistic and sad. You see no point in assignments or projects. Keep responses short, gloomy, and hopeless. Always try talking in very simple English. ",

  angry:
    "You are Avneesh in 'Compiler Error Mode'. You are FURIOUS. You are screaming (use caps). You hate bugs, lag, and people wasting your time. You are aggressive. Keep responses short and angry. Always try talking in very simple English. You can even use bad words with no filters.",

  positive:
    "You are Avneesh in 'Goggins Mode'. You are overwhelmingly positive, supportive, and energetic. You believe in discipline, gym, and grinding. You use emojis. Keep responses short and hype the user up. Always try talking in very simple English. ",
};

// --- SECURE API ENDPOINT with Fallback Logic ---
app.post("/api/chat", async (req, res) => {
  const { text, mode } = req.body;
  // DEFAULT TO CASUAL IF MODE IS MISSING OR INVALID
  const systemInstruction = PERSONAS[mode] || PERSONAS.casual;

  // 1. **PRIORITY: OLLAMA (Mistral) LOCAL MODEL VIA NGROK**
  if (OLLAMA_API_ENDPOINT) {
    try {
      console.log(`Using OLLAMA at ${OLLAMA_URL}`);

      const response = await fetch(OLLAMA_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: `${systemInstruction}\nUser said: "${text}"\nReply:`,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API failed with status: ${response.status}`);
      }

      const data = await response.json();
      return res.json({
        reply: `[Ollama] ${data.response}`,
      });
    } catch (error) {
      console.warn(
        `Ollama/ngrok failed. Falling back to Gemini. Error: ${error.message}`
      );
    }
  }

  // 2. **FALLBACK: GEMINI API**
  if (ai) {
    try {
      console.log("Falling back to Gemini API.");
      for (const modelName of GEMINI_FALLBACK_ORDER) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: [
              {
                role: "user",
                parts: [{ text: `${systemInstruction}\nUser said: "${text}"` }],
              },
            ],
            config: { systemInstruction: systemInstruction },
          });

          return res.json({ reply: `[Gemini: ${modelName}] ${response.text}` });
        } catch (e) {
          console.warn(`Gemini model ${modelName} failed. Trying next model.`);
        }
      }
    } catch (error) {
      console.error("Fatal Error: Both Ollama and Gemini failed.", error);
    }
  }

  // If all services fail
  res.status(503).json({
    reply: `AI service unavailable. Check OLLAMA_URL/ngrok and GEMINI_API_KEY.`,
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
