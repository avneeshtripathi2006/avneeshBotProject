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
const OLLAMA_URL = process.env.OLLAMA_URL || "https://unimposing-mable-subfulgently.ngrok-free.dev";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const SECRET_KEY = process.env.SECRET_KEY || "avneesh_super_secret_key";

const OLLAMA_MODEL = "llama3.1:latest";
const OLLAMA_API_ENDPOINT = OLLAMA_URL ? `${OLLAMA_URL}/api/generate` : null;

// 👇 YOUR REQUESTED MODELS (With a hidden safety net)
const GEMINI_FALLBACK_ORDER = [
  "gemini-2.5-flash-lite", // 1. Try your preferred
  "gemini-2.5-flash",      // 2. Try your preferred
  "gemini-2.5-pro",        // 3. Try your preferred
  "gemini-1.5-flash",      // 4. Backup (High speed)
  "gemini-pro"             // 5. Ultimate Backup (Always works)
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
    // 1. Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // 2. Chat Sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        session_id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
        session_name VARCHAR(100) DEFAULT 'New Chat',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // 3. Chat Records (Original Schema)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_records (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id VARCHAR(255),
        user_name VARCHAR(255),
        user_agent TEXT,
        ip_address VARCHAR(45),
        session_id VARCHAR(255),
        role VARCHAR(50) NOT NULL,
        message_text TEXT NOT NULL,
        mode VARCHAR(50),
        model_used VARCHAR(50)
      );
    `);
    client.release();
    console.log("Database Verified.");
  } catch (err) { console.error("DB Error:", err); }
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
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) { req.user = null; return next(); }
  jwt.verify(token, SECRET_KEY, (err, user) => {
    req.user = err ? null : user;
    next();
  });
};

// ----------------------------------------------------------------------
// ➡️ HELPER: AUTO-TITLE GENERATOR
// ----------------------------------------------------------------------
async function generateSessionTitle(firstMessage) {
  const prompt = `Summarize this message into a short, catchy title (max 4 words). No quotes. Message: "${firstMessage}"`;
  
  // 1. Try Ollama
  if (OLLAMA_API_ENDPOINT) {
    try {
        const response = await fetch(OLLAMA_API_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
            body: JSON.stringify({ model: OLLAMA_MODEL, prompt: prompt, stream: false }),
        });
        if (response.ok) {
            const data = await response.json();
            return data.response.replace(/["\n]/g, '').trim().substring(0, 50);
        }
    } catch (e) { /* ignore */ }
  }

  // 2. Try Gemini (Fallback Loop)
  if (ai) {
    for (const modelName of GEMINI_FALLBACK_ORDER) {
        try {
            const model = ai.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            return (await result.response).text().replace(/["\n]/g, '').trim().substring(0, 50);
        } catch (e) { continue; }
    }
  }

  return "New Chat";
}

// ----------------------------------------------------------------------
// ➡️ API ROUTES
// ----------------------------------------------------------------------

app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query('INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING user_id, username', [username, email, hash]);
    res.status(201).json({ message: 'User registered', user_id: result.rows[0].user_id });
  } catch (error) { res.status(500).json({ message: 'Error registering' }); }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT user_id, username, password_hash FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ user_id: user.user_id, username: user.username }, SECRET_KEY, { expiresIn: '7d' });
    res.json({ message: 'Login successful', token, user_id: user.user_id, username: user.username });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

app.get('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT session_id, session_name, created_at FROM chat_sessions WHERE user_id = $1 ORDER BY created_at DESC', [req.user.user_id]);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ message: 'Error fetching sessions' }); }
});

app.post('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('INSERT INTO chat_sessions (user_id, session_name) VALUES ($1, $2) RETURNING *', [req.user.user_id, req.body.session_name || 'New Chat']);
    res.status(201).json({ session: result.rows[0] });
  } catch (error) { res.status(500).json({ message: 'Error creating session' }); }
});

app.get('/api/chat/:session_id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT role, message_text as content FROM chat_records WHERE session_id = $1 ORDER BY timestamp', [req.params.session_id]);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ message: 'Error fetching history' }); }
});

// MAIN CHAT LOGIC
app.post("/api/chat", optionalAuth, async (req, res) => {
  const { prompt, mode, history, session_id, user_name, user_agent } = req.body;
  const user = req.user;
  const systemInstruction = PERSONAS[mode] || PERSONAS.casual;
  const ipAddress = req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"].split(",")[0] : req.ip;
  const storedUserId = user ? String(user.user_id) : "guest";

  // 1. Build Context
  let contextMessages = [];
  let isFirstMessage = false;

  if (user && session_id && !isNaN(session_id)) {
     try {
       const dbHistory = await pool.query('SELECT role, message_text FROM chat_records WHERE session_id = $1 ORDER BY timestamp', [session_id]);
       contextMessages = dbHistory.rows.map(r => ({ role: r.role, text: r.message_text }));
       if (contextMessages.length === 0) isFirstMessage = true;
     } catch(e) {}
  } else if (Array.isArray(history)) {
     contextMessages = history.map(h => ({ role: h.role, text: h.text }));
  }

  // 2. Generate Response
  let replyText = "";
  let modelUsed = "none";
  
  // A. Ollama (Only if laptop is ON)
  if (OLLAMA_API_ENDPOINT) {
    try {
      let ollamaPrompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n${systemInstruction}<|eot_id|>\n`;
      contextMessages.forEach(msg => ollamaPrompt += `<|start_header_id|>${msg.role==='user'?'user':'assistant'}<|end_header_id|>\n${msg.text}<|eot_id|>\n`);
      ollamaPrompt += `<|start_header_id|>user<|end_header_id|>\n${prompt}<|eot_id|>\n<|start_header_id|>assistant<|end_header_id|>\n`;
      
      const response = await fetch(OLLAMA_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt: ollamaPrompt, stream: false }),
      });
      if (response.ok) {
        const data = await response.json();
        replyText = data.response; modelUsed = OLLAMA_MODEL;
      }
    } catch (e) { 
        console.log("Ollama unreachable. Trying Gemini..."); 
    }
  }

  // B. Gemini (Your Models -> Fallback)
  if (!replyText && ai) {
    try {
      const geminiHistory = contextMessages.map(msg => ({ role: msg.role==='user'?'user':'model', parts: [{ text: msg.text }] }));
      const fullContents = [...geminiHistory, { role: 'user', parts: [{ text: prompt }] }];
      
      // Tries 2.5-flash-lite -> 2.5-flash -> 2.5-pro -> 1.5-flash -> gemini-pro
      for (const modelName of GEMINI_FALLBACK_ORDER) {
        try {
          const model = ai.getGenerativeModel({ model: modelName, systemInstruction });
          const result = await model.generateContent({ contents: fullContents });
          replyText = (await result.response).text(); 
          modelUsed = modelName; 
          break; // Stop loop as soon as ONE works
        } catch (e) { 
            console.warn(`Gemini model ${modelName} unavailable.`);
        }
      }
    } catch (e) { console.error("Fatal Gemini Error:", e); }
  }

  if (!replyText) return res.status(503).json({ response: "AI unavailable." });

  // 3. Save & Auto-Title
  try {
    const saveQ = `INSERT INTO chat_records (session_id, user_id, user_name, user_agent, ip_address, role, message_text, mode, model_used) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
    await pool.query(saveQ, [session_id, storedUserId, user_name, user_agent, ipAddress, 'user', prompt, mode, 'user-input']);
    await pool.query(saveQ, [session_id, storedUserId, user_name, user_agent, ipAddress, 'model', replyText, mode, modelUsed]);

    if (user && session_id && isFirstMessage) {
      const newTitle = await generateSessionTitle(prompt);
      await pool.query('UPDATE chat_sessions SET session_name = $1 WHERE session_id = $2', [newTitle, session_id]);
    }
  } catch (err) { console.error("Save Error:", err); }

  res.json({ response: replyText });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "client/build", "index.html")));
app.listen(port, () => console.log(`Server listening on port ${port}`));