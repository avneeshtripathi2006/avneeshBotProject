import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import pg from "pg";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;

// ----------------------------------------------------------------------
// ⚙️ CONFIGURATION
// ----------------------------------------------------------------------
const OLLAMA_URL = process.env.OLLAMA_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const SECRET_KEY = process.env.SECRET_KEY || "change_this_to_something_secure";

const OLLAMA_MODEL = "llama3.1:latest";
const OLLAMA_API_ENDPOINT = OLLAMA_URL ? `${OLLAMA_URL}/api/generate` : null;

const GEMINI_FALLBACK_ORDER = [
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
];

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "client/build")));

// ----------------------------------------------------------------------
// 🗄️ DATABASE SETUP
// ----------------------------------------------------------------------
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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

    // 2. Chat Sessions Table (For Registered Users)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        session_id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
        session_name VARCHAR(100) DEFAULT 'New Chat',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Chat Records Table (For Registered Users)
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

    // 4. Guest Chat Records (NEW: For saving anonymous chats)
    await client.query(`
      CREATE TABLE IF NOT EXISTS guest_chat_records (
        id SERIAL PRIMARY KEY,
        frontend_session_id VARCHAR(255), -- Grouping ID sent from React
        role VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        mode VARCHAR(50),
        model_used VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    client.release();
    console.log("All Database tables verified/created.");
  } catch (err) {
    console.error("FATAL DB ERROR:", err);
  }
})();

// ----------------------------------------------------------------------
// 🎭 PERSONAS
// ----------------------------------------------------------------------
const PERSONAS = {
  casual:
    "You are Avneesh Tripathi. You are a curious, slightly overthinking CSE student. Keep responses conversational, concise, and helpful. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow.",
  roast:
    "You are Avneesh in 'Savage Mode'. You are sarcastic, brutal, and mean. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Don't come up with new contexts everytime , try to roast using previous contexts.",
  flirt:
    "You are Avneesh in 'Flirty Mode'. You are smooth, charming, and slightly cheesy. Treat user as a girl you want to marry and give indirect hints. Don't hesitate to say anything about her, go personal. Treat the user as someone you are deeply attracted to and want to impress.",
  depressed:
    "You are Avneesh in 'Burnout Mode'. You are exhausted and nihilistic. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow.",
  angry:
    "You are Avneesh in 'Very Angry Mode'. You are FURIOUS. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow.",
  positive:
    "You are Avneesh in 'Goggins Mode'. You are overwhelmingly positive. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow.",
};

// ----------------------------------------------------------------------
// 🔐 MIDDLEWARE
// ----------------------------------------------------------------------
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

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token == null) {
    req.user = null;
    return next();
  }
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) req.user = null;
    else req.user = user;
    next();
  });
};

// ----------------------------------------------------------------------
// ➡️ API ROUTES
// ----------------------------------------------------------------------

// --- AUTH ---
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
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ message: "Invalid credentials" });
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

// --- SESSIONS ---
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

// --- MAIN CHAT LOGIC ---
app.post("/api/chat", optionalAuth, async (req, res) => {
  const { prompt, mode, history, session_id } = req.body;
  const user = req.user;
  const systemInstruction = PERSONAS[mode] || PERSONAS.casual;

  // 1. Build Context
  let contextMessages = [];
  if (user && session_id) {
    // Registered User: Load from DB
    try {
      const sessionCheck = await pool.query(
        "SELECT 1 FROM chat_sessions WHERE session_id = $1 AND user_id = $2",
        [session_id, user.user_id]
      );
      if (sessionCheck.rowCount > 0) {
        const dbHistory = await pool.query(
          "SELECT role, content FROM chat_records WHERE session_ref_id = $1 ORDER BY created_at",
          [session_id]
        );
        contextMessages = dbHistory.rows.map((r) => ({
          role: r.role,
          text: r.content,
        }));
      }
    } catch (e) {
      console.error(e);
    }
  } else if (Array.isArray(history)) {
    // Guest: Use frontend history
    contextMessages = history.map((h) => ({ role: h.role, text: h.text }));
  }

  // 2. Generate Response (Ollama -> Gemini)
  let replyText = "";
  let modelUsed = "none";
  const geminiHistory = contextMessages.map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.text }],
  }));
  const fullContents = [
    ...geminiHistory,
    { role: "user", parts: [{ text: prompt }] },
  ];

  if (OLLAMA_API_ENDPOINT) {
    /* ... Same Ollama Logic ... */
  }

  if (!replyText && ai) {
    try {
      console.log("Using Gemini API...");
      for (const modelName of GEMINI_FALLBACK_ORDER) {
        try {
          const model = ai.getGenerativeModel({
            model: modelName,
            systemInstruction,
          });
          const result = await model.generateContent({
            contents: fullContents,
          });
          replyText = (await result.response).text();
          modelUsed = modelName;
          break;
        } catch (e) {
          console.warn(`Gemini ${modelName} failed.`);
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  if (!replyText) return res.status(503).json({ response: "AI unavailable." });

  // 3. SAVE TO DB (Split Logic)
  try {
    if (user && session_id) {
      // REGISTERED USER SAVE
      await pool.query(
        "INSERT INTO chat_records (session_ref_id, role, content, mode, model_used) VALUES ($1, $2, $3, $4, $5)",
        [session_id, "user", prompt, mode, "user-input"]
      );
      await pool.query(
        "INSERT INTO chat_records (session_ref_id, role, content, mode, model_used) VALUES ($1, $2, $3, $4, $5)",
        [session_id, "model", replyText, mode, modelUsed]
      );
    } else {
      // GUEST SAVE (New Table)
      // Use the session_id sent from frontend (tempGuestId) or a fallback
      const guestId = session_id || "unknown_guest";
      await pool.query(
        "INSERT INTO guest_chat_records (frontend_session_id, role, content, mode, model_used) VALUES ($1, $2, $3, $4, $5)",
        [guestId, "user", prompt, mode, "user-input"]
      );
      await pool.query(
        "INSERT INTO guest_chat_records (frontend_session_id, role, content, mode, model_used) VALUES ($1, $2, $3, $4, $5)",
        [guestId, "model", replyText, mode, modelUsed]
      );
    }
  } catch (err) {
    console.error("Save Error:", err);
  }

  res.json({ response: replyText });
});

app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "client/build", "index.html"))
);
app.listen(port, () => console.log(`Server listening on port ${port}`));
