// server.js (FINAL FIX)

import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
// ✅ FIXED IMPORT NAME
import { GoogleGenerativeAI } from "@google/generative-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// ----------------------------------------------------------------------
// 👇 CONFIGURE API SETTINGS 👇
const OLLAMA_URL = process.env.OLLAMA_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OLLAMA_MODEL = "mistral:latest"; 
const OLLAMA_API_ENDPOINT = OLLAMA_URL ? `${OLLAMA_URL}/api/chat` : null;

// Gemini Setup
const GEMINI_FALLBACK_ORDER = ["gemini-2.0-flash-lite", "gemini-1.5-flash"];
// ✅ FIXED CLASS NAME HERE
const ai = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
// ----------------------------------------------------------------------

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- 🧠 SIMPLE MEMORY STORAGE ---
let chatHistory = [];
let lastMode = null; 

// --- PERSONAS ---
const PERSONAS = {
  casual: `You are Avneesh Tripathi. You are a curious CSE student. Keep responses conversational, concise, helpful and short unless long reply is really required and user wants that. You may also use hinglish.`,
  roast: "You are Avneesh in 'Savage Mode'. You roast the user very badly , and also use offensive words. Keep it in simple english. You may also use hinglish",
  flirt: "You are Avneesh in 'Flirting Mode as a boy'. You are smooth and charming and indirectly trying to propose the user assuming that the user is a girl. Keep the vocabulary simple. You may also use hinglish.",
  depressed: "You are Avneesh in 'Burnout Mode'. You are sad and tired. You may also use hinglish.",
  angry: "You are Avneesh in 'Angry Mode'. You are furious. Use offensive words. You may also use hinglish.",
  positive: "You are Avneesh in 'Goggins Mode'. You are energetic and supportive. You may also use hinglish.",
};

app.post("/api/chat", async (req, res) => {
  const { text, mode } = req.body;
  const currentMode = mode || "casual";
  const systemInstruction = PERSONAS[currentMode] || PERSONAS.casual;

  // 1. RESET MEMORY IF PERSONA CHANGED
  if (lastMode !== currentMode) {
    chatHistory = [];
    console.log(`🔄 Mode changed to ${currentMode}. Memory cleared.`);
    lastMode = currentMode;
  }

  // 2. ADD USER MESSAGE TO HISTORY
  chatHistory.push({ role: "user", content: text });

  // 3. PREPARE MESSAGES FOR OLLAMA
  const ollamaMessages = [
    { role: "system", content: systemInstruction },
    ...chatHistory, 
  ];

  // --- ATTEMPT 1: OLLAMA ---
  if (OLLAMA_API_ENDPOINT) {
    try {
      console.log(`Attempting OLLAMA with ${chatHistory.length} msgs history...`);

      const response = await fetch(OLLAMA_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: ollamaMessages, 
          stream: false,
        }),
      });

      if (!response.ok) throw new Error(`Status: ${response.status}`);

      const data = await response.json();
      const botReply = data.message?.content || "(No response)";

      chatHistory.push({ role: "assistant", content: botReply });

      return res.json({ reply: `[Ollama] ${botReply}` });
    } catch (error) {
      console.warn(`⚠️ Ollama failed: ${error.message}`);
    }
  }

  // --- ATTEMPT 2: GEMINI FALLBACK ---
  if (ai) {
    console.log("🔄 Switching to Gemini...");

    const geminiHistory = chatHistory.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    for (const modelName of GEMINI_FALLBACK_ORDER) {
      try {
        const model = ai.getGenerativeModel({
          model: modelName,
          systemInstruction: systemInstruction,
        });

        const chatSession = model.startChat({
          history: geminiHistory.slice(0, -1), 
        });

        const result = await chatSession.sendMessage(text);
        const botReply = result.response.text();

        chatHistory.push({ role: "assistant", content: botReply });

        return res.json({ reply: `[Gemini: ${modelName}] ${botReply}` });
      } catch (e) {
        console.warn(`❌ Gemini ${modelName} failed: ${e.message}`);
      }
    }
  }

  res.status(503).json({ reply: "Error: All AI services failed." });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});