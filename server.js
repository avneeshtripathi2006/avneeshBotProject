import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import pg from "pg"; // Changed to 'pg' to use Pool
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000; // Recommend 5000 to avoid conflict with React (3000)

// ----------------------------------------------------------------------
// ⚙️ CONFIGURATION & MIDDLEWARE
// ----------------------------------------------------------------------
const OLLAMA_URL = process.env.OLLAMA_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const SECRET_KEY =
  process.env.SECRET_KEY || "avneesh_super_secret_key_change_me"; // ENV variable recommended

const OLLAMA_MODEL = "llama3.1:latest";
const OLLAMA_API_ENDPOINT = OLLAMA_URL ? `${OLLAMA_URL}/api/generate` : null;

const GEMINI_FALLBACK_ORDER = [
  "gemini-2.0-flash-lite", // Updated to likely available models
  "gemini-2.0-flash",
  "gemini-1.5-pro",
];

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

app.use(cors()); // Allow Frontend to talk to Backend
app.use(express.json());
app.use(express.static(path.join(__dirname, "client/build")));

// ----------------------------------------------------------------------
// 🗄️ DATABASE SETUP (Relational Schema)
// ----------------------------------------------------------------------
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Initialize Tables (Users, Sessions, Records)
(async () => {
  try {
    const client = await pool.connect();
    console.log("Database connected successfully!");

    // 1. Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Chat Sessions Table (The Sidebar)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        session_id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
        session_name VARCHAR(100) DEFAULT 'New Chat',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Chat Records Table (Linked to Sessions)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_records (
        id SERIAL PRIMARY KEY,
        session_ref_id INT REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        mode VARCHAR(50),
        model_used VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    client.release();
    console.log("Database tables verified/created.");
  } catch (err) {
    console.error("FATAL DB ERROR:", err);
  }
})();

// ----------------------------------------------------------------------
// 🎭 PERSONAS
// ----------------------------------------------------------------------
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
// 🔐 MIDDLEWARE
// ----------------------------------------------------------------------

// 1. Strict Auth (For managing sessions)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// 2. Optional Auth (For Chat - handles Guests vs Users)
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null) {
    req.user = null; // Guest
    return next();
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) req.user = null; // Invalid token -> treat as Guest
    else req.user = user; // Registered User
    next();
  });
};

// ----------------------------------------------------------------------
// ➡️ API ROUTES
// ----------------------------------------------------------------------

// --- AUTHENTICATION ---
app.post("/api/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ message: "All fields required" });

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING user_id, username",
      [username, email, hash]
    );
    res
      .status(201)
      .json({ message: "User registered", user_id: result.rows[0].user_id });
  } catch (error) {
    if (error.code === "23505")
      return res.status(409).json({ message: "Email already exists" });
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT user_id, username, password_hash FROM users WHERE email = $1",
      [email]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { user_id: user.user_id, username: user.username },
      SECRET_KEY,
      { expiresIn: "7d" }
    );
    res.json({
      message: "Login successful",
      token,
      user_id: user.user_id,
      username: user.username,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// --- SESSIONS (Sidebar) ---
app.get("/api/sessions", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT session_id, session_name, created_at FROM chat_sessions WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.user_id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Error fetching sessions" });
  }
});

app.post("/api/sessions", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "INSERT INTO chat_sessions (user_id, session_name) VALUES ($1, $2) RETURNING *",
      [req.user.user_id, req.body.session_name || "New Chat"]
    );
    res.status(201).json({ session: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: "Error creating session" });
  }
});

app.get("/api/chat/:session_id", authenticateToken, async (req, res) => {
  try {
    // Verify ownership
    const check = await pool.query(
      "SELECT 1 FROM chat_sessions WHERE session_id = $1 AND user_id = $2",
      [req.params.session_id, req.user.user_id]
    );
    if (check.rowCount === 0) return res.sendStatus(403);

    const result = await pool.query(
      "SELECT role, content, created_at FROM chat_records WHERE session_ref_id = $1 ORDER BY created_at",
      [req.params.session_id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Error fetching history" });
  }
});

// --- CHAT GENERATION (The Core Logic) ---
app.post("/api/chat", optionalAuth, async (req, res) => {
  // 1. Setup Data
  const { prompt, mode, history, session_id } = req.body; // 'prompt' matches updated frontend
  const user = req.user; // Will be null if Guest
  const systemInstruction = PERSONAS[mode] || PERSONAS.casual;

  // 2. Build Context (Guest vs User)
  let contextMessages = [];

  if (user && session_id) {
    // REGISTERED: Fetch from DB
    try {
      const sessionCheck = await pool.query(
        "SELECT 1 FROM chat_sessions WHERE session_id = $1 AND user_id = $2",
        [session_id, user.user_id]
      );
      if (sessionCheck.rowCount === 0)
        return res.status(403).json({ message: "Session Access Denied" });

      const dbHistory = await pool.query(
        "SELECT role, content FROM chat_records WHERE session_ref_id = $1 ORDER BY created_at",
        [session_id]
      );

      // Standardize format for processing
      contextMessages = dbHistory.rows.map((r) => ({
        role: r.role,
        text: r.content,
      }));
    } catch (e) {
      console.error("DB Context Error", e);
    }
  } else {
    // GUEST: Use history sent from frontend
    // Map frontend {role: 'model'} to {role: 'assistant'/'model'} as needed
    if (Array.isArray(history)) {
      contextMessages = history.map((h) => ({ role: h.role, text: h.text }));
    }
  }

  // Add current prompt to context for generation
  const currentMessageObj = { role: "user", text: prompt };

  // ---------------------------------------------------------
  // AI GENERATION LOGIC (Ollama -> Gemini Fallback)
  // ---------------------------------------------------------
  let replyText = "";
  let modelUsed = "none";

  // A. Try OLLAMA
  if (OLLAMA_API_ENDPOINT) {
    try {
      console.log(`Using OLLAMA...`);
      let ollamaPrompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n${systemInstruction}<|eot_id|>\n`;

      contextMessages.forEach((msg) => {
        const role = msg.role === "user" ? "user" : "assistant";
        ollamaPrompt += `<|start_header_id|>${role}<|end_header_id|>\n${msg.text}<|eot_id|>\n`;
      });
      ollamaPrompt += `<|start_header_id|>user<|end_header_id|>\n${prompt}<|eot_id|>\n<|start_header_id|>assistant<|end_header_id|>\n`;

      const response = await fetch(OLLAMA_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: ollamaPrompt,
          stream: false,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        replyText = data.response; // Removed "[Ollama]" prefix for cleaner chat
        modelUsed = OLLAMA_MODEL;
      } else {
        throw new Error("Ollama failed");
      }
    } catch (error) {
      console.warn(`Ollama failed: ${error.message}`);
    }
  }

  // B. Try GEMINI (If Ollama failed or not configured)
  if (!replyText && ai) {
    try {
      console.log("Using Gemini API...");

      // Convert standard context to Gemini format
      const geminiHistory = contextMessages.map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
      }));
      // Note: Do NOT push the current prompt to history here; generateContent takes it separately or via contents

      // Gemini 'contents' includes history + current prompt
      const fullGeminiContents = [
        ...geminiHistory,
        { role: "user", parts: [{ text: prompt }] },
      ];

      for (const modelName of GEMINI_FALLBACK_ORDER) {
        try {
          const model = ai.getGenerativeModel({
            model: modelName,
            systemInstruction: systemInstruction,
          });

          const result = await model.generateContent({
            contents: fullGeminiContents,
          });

          const response = await result.response;
          replyText = response.text();
          modelUsed = modelName;
          break; // Success! Stop trying models.
        } catch (e) {
          console.warn(`Gemini ${modelName} failed.`);
        }
      }
    } catch (error) {
      console.error("Gemini Fatal Error", error);
    }
  }

  // 3. Final Response Handling
  if (!replyText) {
    return res
      .status(503)
      .json({
        response:
          "I'm sorry, I'm having trouble connecting to my brain right now. Please try again.",
      });
  }

  // 4. Save to DB (ONLY IF REGISTERED USER)
  if (user && session_id) {
    try {
      await pool.query(
        "INSERT INTO chat_records (session_ref_id, role, content, mode, model_used) VALUES ($1, $2, $3, $4, $5)",
        [session_id, "user", prompt, mode, "user-input"]
      );
      await pool.query(
        "INSERT INTO chat_records (session_ref_id, role, content, mode, model_used) VALUES ($1, $2, $3, $4, $5)",
        [session_id, "model", replyText, mode, modelUsed]
      );
    } catch (dbErr) {
      console.error("Failed to save chat to DB:", dbErr);
    }
  }

  // 5. Send Response
  // Frontend expects { response: "..." }
  res.json({ response: replyText });
});

// Serve React App for any other route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/build", "index.html"));
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
