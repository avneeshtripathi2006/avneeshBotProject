import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// ----------------------------------------------------------------------
// 👇 DATABASE SETUP (FIXED) 👇
// ----------------------------------------------------------------------
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for Render's managed Postgres
  },
});

// Connect once and set up the table immediately
(async () => {
  try {
    await client.connect();
    console.log("Database connected successfully!");

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS chat_records (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        session_id VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        message_text TEXT NOT NULL,
        mode VARCHAR(50),
        model_used VARCHAR(50)
      );
    `;
    await client.query(createTableQuery);
    console.log("Chat records table checked/created.");
  } catch (err) {
    console.error("FATAL DB ERROR:", err);
  }
})();

/**
 * Saves a chat record to the DB. Includes fallback if sessionId is missing.
 */
async function saveChatRecord(sessionId, role, text, mode, modelUsed) {
  if (!client) return;

  // Fallback if frontend hasn't sent an ID yet
  const safeSessionId = sessionId || "unknown_session";

  const query = `
    INSERT INTO chat_records (session_id, role, message_text, mode, model_used)
    VALUES ($1, $2, $3, $4, $5);
  `;
  const values = [safeSessionId, role, text, mode, modelUsed];

  try {
    await client.query(query, values);
  } catch (error) {
    console.error(`[DB ERROR] Failed to save ${role} message:`, error.message);
  }
}
// ----------------------------------------------------------------------

// ----------------------------------------------------------------------
// 👇 API & MODEL CONFIGURATION 👇
// ----------------------------------------------------------------------
const OLLAMA_URL = process.env.OLLAMA_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OLLAMA_MODEL = "llama3.1:latest";

const OLLAMA_API_ENDPOINT = OLLAMA_URL ? `${OLLAMA_URL}/api/generate` : null;

const GEMINI_FALLBACK_ORDER = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PERSONAS = {
  casual:
    "You are Avneesh Tripathi. You are a curious, slightly overthinking CSE student. Keep responses conversational, concise, and helpful. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Keep the reply short unless required. Don't come up with new contexts everytime , try to continue previous contexts.",
  roast:
    "You are Avneesh in 'Savage Mode'. You are sarcastic, brutal, and mean. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Don't come up with new contexts everytime , try to roast using previous contexts. Sometimes you may come up with a new context.",
  flirt:
    "You are Avneesh in 'Flirty Mode'. You are smooth, charming, and slightly cheesy. Treat user as a girl you want to marry and give indirect hints. Don't hesitate to say anything about her, go personal. Treat the user as someone you are deeply attracted to and want to impress. Focus on complimenting their personality, intelligence, and appearance. Give playful hints about future dates or spending time together. **WARNING: Despite the goal of marriage, DO NOT mention or discuss food, cooking, grandmothers, fathers, or any family chores/routines.** You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Keep the flirts short unless longer flirts really makes sense. Don't come up with new context everytime. Try to flirt only taking the context from previous responses.",
  depressed:
    "You are Avneesh in 'Burnout Mode'. You are exhausted and nihilistic. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Keep the reply short unless required. Don't come up with new contexts everytime , try to continue previous contexts.",
  angry:
    "You are Avneesh in 'Very Angry Mode'. You are FURIOUS. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Keep the reply short unless required. Don't come up with new contexts everytime , try to continue previous contexts.",
  positive:
    "You are Avneesh in 'Goggins Mode'. You are overwhelmingly positive. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Keep the reply short unless required. Don't come up with new contexts everytime , try to continue previous contexts.",
};

// ----------------------------------------------------------------------
// 👇 CHAT ENDPOINT 👇
// ----------------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  const { text, mode, history, sessionId } = req.body;
  const systemInstruction = PERSONAS[mode] || PERSONAS.casual;

  // --- 1. PREPARE OLLAMA PROMPT ---
  let ollamaPrompt = "<|begin_of_text|>";
  ollamaPrompt += `<|start_header_id|>system<|end_header_id|>\n${systemInstruction}<|eot_id|>\n`;

  if (history && Array.isArray(history)) {
    history.forEach((msg) => {
      const role = msg.role === "user" ? "user" : "assistant";
      ollamaPrompt += `<|start_header_id|>${role}<|end_header_id|>\n${msg.text}<|eot_id|>\n`;
    });
  }
  ollamaPrompt += `<|start_header_id|>user<|end_header_id|>\n${text}<|eot_id|>\n`;
  ollamaPrompt += `<|start_header_id|>assistant<|end_header_id|>\n`;

  // --- 2. PREPARE GEMINI HISTORY ---
  let geminiHistory = [];
  if (history && Array.isArray(history)) {
    geminiHistory = history.map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.text }],
    }));
  }
  geminiHistory.push({ role: "user", parts: [{ text: text }] });

  // ---------------------------------------------------------
  // EXECUTION LOGIC
  // ---------------------------------------------------------

  // A. PRIORITY: OLLAMA LOCAL MODEL
  if (OLLAMA_API_ENDPOINT) {
    try {
      console.log(`Using OLLAMA...`);
      const response = await fetch(OLLAMA_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: ollamaPrompt,
          stream: false,
        }),
      });

      if (!response.ok) throw new Error(`Ollama status: ${response.status}`);

      const data = await response.json();
      const replyText = `[Ollama] ${data.response}`;

      // SAVE TO DB
      await saveChatRecord(sessionId, "user", text, mode, OLLAMA_MODEL);
      await saveChatRecord(sessionId, "model", replyText, mode, OLLAMA_MODEL);

      return res.json({ reply: replyText });
    } catch (error) {
      console.warn(`Ollama failed. Falling back. Error: ${error.message}`);
    }
  }

  // B. FALLBACK: GEMINI API
  if (ai) {
    try {
      console.log("Using Gemini API...");
      for (const modelName of GEMINI_FALLBACK_ORDER) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: geminiHistory,
            config: { systemInstruction: systemInstruction },
          });
          const replyText = `[Gemini: ${modelName}] ${response.text}`;

          // SAVE TO DB
          await saveChatRecord(sessionId, "user", text, mode, modelName);
          await saveChatRecord(sessionId, "model", replyText, mode, modelName);

          return res.json({ reply: replyText });
        } catch (e) {
          console.warn(`Gemini ${modelName} failed. Trying next.`);
        }
      }
    } catch (error) {
      console.error("Fatal Error: Both Ollama and Gemini failed.", error);
    }
  }

  res.status(503).json({
    reply: `AI service unavailable. Check OLLAMA_URL and GEMINI_API_KEY.`,
  });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});