import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";
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

// 👇 UPDATED MODEL LIST: Standard models with higher quotas
const GEMINI_FALLBACK_ORDER = [
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro",
  "gemini-1.5-pro-latest",
  "gemini-pro"
];

const ai = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

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
    await client.query(`CREATE TABLE IF NOT EXISTS users (user_id SERIAL PRIMARY KEY, username VARCHAR(50) NOT NULL, email VARCHAR(100) UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await client.query(`CREATE TABLE IF NOT EXISTS chat_sessions (session_id SERIAL PRIMARY KEY, user_id INT REFERENCES users(user_id) ON DELETE CASCADE, session_name VARCHAR(100) DEFAULT 'New Chat', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await client.query(`CREATE TABLE IF NOT EXISTS chat_records (id SERIAL PRIMARY KEY, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, user_id INT, user_name VARCHAR(255), user_agent TEXT, ip_address VARCHAR(45), session_id INT, role VARCHAR(50) NOT NULL, message_text TEXT NOT NULL, mode VARCHAR(50), model_used VARCHAR(50));`);
    client.release();
    console.log("Database Verified.");
  } catch (err) { console.error("DB Error:", err); }
})();

// ----------------------------------------------------------------------
// 🎭 PERSONAS
// ----------------------------------------------------------------------
const PERSONAS = {
  casual: "You are Avneesh Tripathi. You are a curious, slightly overthinking CSE student. Keep responses conversational, concise, and helpful. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Keep the reply short unless required. Don't come up with new contexts everytime , try to continue previous contexts.",
  roast: "You are Avneesh in 'Savage Mode'. You are sarcastic, brutal, and mean. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Don't come up with new contexts everytime , try to roast using previous contexts. Sometimes you may come up with a new context.",
  flirt: "You are Avneesh in 'Flirty Mode'. You are smooth, charming, and slightly cheesy. Treat user as a girl you want to marry and give indirect hints. Don't hesitate to say anything about her, go personal. Treat the user as someone you are deeply attracted to and want to impress. Focus on complimenting their personality, intelligence, and appearance. Give playful hints about future dates or spending time together. **WARNING: Despite the goal of marriage, DO NOT mention or discuss food, cooking, grandmothers, fathers, or any family chores/routines.** You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Keep the flirts short unless longer flirts really makes sense. Don't come up with new context everytime. Try to flirt only taking the context from previous responses.",
  depressed: "You are Avneesh in 'Burnout Mode'. You are exhausted and nihilistic. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Keep the reply short unless required. Don't come up with new contexts everytime , try to continue previous contexts.",
  angry: "You are Avneesh in 'Very Angry Mode'. You are FURIOUS. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Keep the reply short unless required. Don't come up with new contexts everytime , try to continue previous contexts.",
  positive: "You are Avneesh in 'Goggins Mode'. You are overwhelmingly positive. You try talking in Simple English. Your Biggest priority is to maintain the conversation flow. Keep the reply short unless required. Don't come up with new contexts everytime , try to continue previous contexts.",
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
// ➡️ HELPER: SYSTEM GUEST & AUTO-TITLE
// ----------------------------------------------------------------------
async function getOrCreateGuestUser() {
    try {
        let res = await pool.query("SELECT user_id FROM users WHERE email = 'guest@system.local'");
        if (res.rows.length > 0) return res.rows[0].user_id;

        const hash = await bcrypt.hash("guest_cannot_login", 10);
        res = await pool.query(
            "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING user_id, username",
            ["System Guest", "guest@system.local", hash]
        );
        console.log("✅ System Guest User Created with ID:", res.rows[0].user_id);
        return res.rows[0].user_id;
    } catch (e) {
        console.error("Error ensuring guest user:", e);
        return null;
    }
}

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
    } catch (e) { /* Ollama unreachable? Fallback to Gemini */ }
  }

  // 2. Try Gemini Fallback 
  if (ai) {
    for (const modelName of GEMINI_FALLBACK_ORDER) {
        try {
            const isLegacy = modelName === "gemini-pro";
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

// ----------------------------------------------------------------------
// 🚀 STREAMING CHAT ROUTE (FINAL)
// ----------------------------------------------------------------------
app.post("/api/chat", optionalAuth, async (req, res) => {
  let { prompt, mode, history, session_id, user_name, user_agent } = req.body;
  let user = req.user;

  // 1. SETUP USER & SESSION
  let currentUserId = user ? user.user_id : null;
  let isGuestSession = false;

  if (!currentUserId) {
      currentUserId = await getOrCreateGuestUser();
      isGuestSession = true;
  }
  
  if ((!session_id || String(session_id).startsWith('guest-') || isNaN(session_id)) && currentUserId) {
      try {
          const newSession = await pool.query(
              'INSERT INTO chat_sessions (user_id, session_name) VALUES ($1, $2) RETURNING session_id',
              [currentUserId, isGuestSession ? 'Guest Chat' : 'New Chat']
          );
          session_id = newSession.rows[0].session_id;
      } catch (e) { console.error("Session Error:", e); }
  }
  session_id = parseInt(session_id);

  // 2. PREPARE RESPONSE HEADERS
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('x-session-id', session_id); 

  const systemInstruction = PERSONAS[mode] || PERSONAS.casual;
  const ipAddress = req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"].split(",")[0] : req.ip;

  // 3. BUILD CONTEXT
  let contextMessages = [];
  let isFirstMessage = false;

  try {
    const dbHistory = await pool.query('SELECT role, message_text FROM chat_records WHERE session_id = $1 ORDER BY timestamp', [session_id]);
    contextMessages = dbHistory.rows.map(r => ({ role: r.role, text: r.message_text }));
    if (contextMessages.length === 0) isFirstMessage = true;
  } catch(e) {}
  
  if (contextMessages.length === 0 && Array.isArray(history)) {
      contextMessages = history.map(h => ({ role: h.role, text: h.text }));
  }

  // 4. STREAMING LOGIC
  let fullReplyText = "";
  let modelUsed = "none";
  let streamingError = null;

  try {
      // A. OLLAMA
      if (OLLAMA_API_ENDPOINT) {
        try {
             let ollamaPrompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n${systemInstruction}<|eot_id|>\n`;
             contextMessages.forEach(msg => ollamaPrompt += `<|start_header_id|>${msg.role==='user'?'user':'assistant'}<|end_header_id|>\n${msg.text}<|eot_id|>\n`);
             ollamaPrompt += `<|start_header_id|>user<|end_header_id|>\n${prompt}<|eot_id|>\n<|start_header_id|>assistant<|end_header_id|>\n`;

             const response = await fetch(OLLAMA_API_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: OLLAMA_MODEL, prompt: ollamaPrompt, stream: true }),
             });

             if (response.ok && response.body) {
                 modelUsed = OLLAMA_MODEL;
                 let buffer = "";
                 for await (const chunk of response.body) {
                     buffer += chunk.toString();
                     const lines = buffer.split("\n"); 
                     buffer = lines.pop(); // Hold incomplete line
                     for (const line of lines) {
                         if (!line.trim()) continue;
                         try {
                             const json = JSON.parse(line);
                             if (json.response) {
                                 res.write(json.response);
                                 fullReplyText += json.response;
                             }
                         } catch(e) {}
                     }
                 }
                 // Flush remaining buffer
                 if (buffer.trim()) {
                     try {
                         const json = JSON.parse(buffer);
                         if (json.response) { res.write(json.response); fullReplyText += json.response; }
                     } catch (e) {}
                 }
             }
        } catch (e) { console.log("Ollama Skipped"); }
      }

      // B. GEMINI FALLBACK
      if (!fullReplyText && ai) {
         const geminiHistory = contextMessages.map(msg => ({ role: msg.role==='user'?'user':'model', parts: [{ text: msg.text }] }));
         const fullContents = [...geminiHistory, { role: 'user', parts: [{ text: prompt }] }];

         for (const modelName of GEMINI_FALLBACK_ORDER) {
            try {
                const isLegacy = modelName === "gemini-pro";
                const modelConfig = { model: modelName };
                if (!isLegacy) modelConfig.systemInstruction = systemInstruction;
                
                const model = ai.getGenerativeModel(modelConfig);
                const result = await model.generateContentStream({ contents: fullContents });
                
                modelUsed = modelName;
                for await (const chunk of result.stream) {
                    const chunkText = chunk.text();
                    res.write(chunkText); 
                    fullReplyText += chunkText;
                }
                streamingError = null; 
                break;
            } catch (e) { 
                console.warn(`Gemini ${modelName} failed:`, e.message); 
                streamingError = e.message;
            }
         }
      }

      // 🛠️ CRITICAL FIX: If ALL models fail, tell the frontend!
      if (!fullReplyText) {
          const errMsg = streamingError ? ` (Error: ${streamingError})` : "";
          const sorry = `[System Message: All AI models are currently busy or unavailable.${errMsg} Please try again in a minute.]`;
          res.write(sorry);
          fullReplyText = sorry;
      }

  } catch (err) {
      console.error("Stream Error:", err);
      res.write(`\n[System Error: ${err.message}]`);
  }

  res.end();

  // 5. POST-STREAM: DB SAVE & TITLE GENERATION
  if (fullReplyText) {
      try {
        const saveQ = `INSERT INTO chat_records (session_id, user_id, user_name, user_agent, ip_address, role, message_text, mode, model_used) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
        await pool.query(saveQ, [session_id, parseInt(currentUserId), user_name, user_agent, ipAddress, 'user', prompt, mode, 'user-input']);
        await pool.query(saveQ, [session_id, parseInt(currentUserId), user_name, user_agent, ipAddress, 'model', fullReplyText, mode, modelUsed]);

        if (isFirstMessage) {
            const sessionCheck = await pool.query('SELECT session_name FROM chat_sessions WHERE session_id = $1', [session_id]);
            const currentTitle = sessionCheck.rows[0]?.session_name;
            if (currentTitle === 'New Chat' || currentTitle === 'Guest Chat') {
                const newTitle = await generateSessionTitle(prompt);
                if (newTitle) await pool.query('UPDATE chat_sessions SET session_name = $1 WHERE session_id = $2', [newTitle, session_id]);
            }
        }
      } catch (err) { console.error("Save Error:", err); }
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "client/build", "index.html")));
app.listen(port, () => console.log(`Server listening on port ${port}`));