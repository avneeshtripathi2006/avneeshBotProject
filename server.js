// server.js (UPDATED WITH CONTEXT/MEMORY)

import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// ----------------------------------------------------------------------
// 👇 CONFIGURE API SETTINGS 👇
const OLLAMA_URL = process.env.OLLAMA_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OLLAMA_MODEL = "llama3.1:latest"; // Ensure this matches your downloaded model

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

const PERSONAS = {
  casual: `You are Avneesh Tripathi. You are a curious, slightly overthinking CSE student. Keep responses conversational, concise, and helpful. You try talking in Hindi + Simple English..`,
  roast:
    "You are Avneesh in 'Savage Mode'. You are sarcastic, brutal, and mean. You try talking in Hindi + Simple English.",
  flirt:
    "You are Avneesh in 'Flirty Mode'. You are smooth, charming, and slightly cheesy.Treat user as a girl you want to marry and give indirect hints. Don't hesitate to say anything about her , go personal. You try talking in Hindi + Simple English.",
  depressed:
    "You are Avneesh in 'Burnout Mode'. You are exhausted and nihilistic. You try talking in Hindi + Simple English.",
  angry: "You are Avneesh in 'Very Angry Mode'. You are FURIOUS. You try talking in Hindi + Simple English.",
  positive:
    "You are Avneesh in 'Goggins Mode'. You are overwhelmingly positive. You try talking in Hindi + Simple English.",
};

// --- SECURE API ENDPOINT with Context & Fallback ---
app.post("/api/chat", async (req, res) => {
  // 👇 NEW: We now extract 'history' from the request body
  const { text, mode, history } = req.body;

  const systemInstruction = PERSONAS[mode] || PERSONAS.casual;

  // ---------------------------------------------------------
  // 1. PREPARE OLLAMA PROMPT (String Construction)
  // ---------------------------------------------------------
  // We build a single large string containing the System Prompt + History + Current Message
  let ollamaPrompt = `${systemInstruction}\n\n`;

  // If history exists, append it to the prompt
  if (history && Array.isArray(history)) {
    history.forEach((msg) => {
      const roleName = msg.role === "user" ? "User" : "Avneesh";
      ollamaPrompt += `${roleName}: "${msg.text}"\n`;
    });
  }
  // Add the current user message
  ollamaPrompt += `User: "${text}"\nAvneesh:`;

  // ---------------------------------------------------------
  // 2. PREPARE GEMINI CONTEXT (Structured Array)
  // ---------------------------------------------------------
  // Gemini needs a specific array format: { role: 'user'|'model', parts: [{ text: ... }] }
  let geminiHistory = [];

  if (history && Array.isArray(history)) {
    geminiHistory = history.map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.text }],
    }));
  }

  // Add the current message to the Gemini history array
  geminiHistory.push({ role: "user", parts: [{ text: text }] });

  // ---------------------------------------------------------
  // EXECUTION LOGIC
  // ---------------------------------------------------------

  // 1. **PRIORITY: OLLAMA LOCAL MODEL**
  if (OLLAMA_API_ENDPOINT) {
    try {
      console.log(`Using OLLAMA with Context...`);

      const response = await fetch(OLLAMA_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: ollamaPrompt, // Use the prompt with history included
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
      console.log("Falling back to Gemini API with Context.");
      for (const modelName of GEMINI_FALLBACK_ORDER) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: geminiHistory, // Pass the full history array
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

  res.status(503).json({
    reply: `AI service unavailable. Check OLLAMA_URL/ngrok and GEMINI_API_KEY.`,
  });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
