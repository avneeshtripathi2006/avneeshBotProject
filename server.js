/**
 * @file server.js
 * @description Enterprise-Grade Multi-Model AI Engine for the Avneesh Bot Project.
 * @author Avneesh Tripathi (Software Engineering Student, Kanpur)
 * @version 3.7.1
 * ----------------------------------------------------------------------
 * DESIGN PHILOSOPHY:
 * 1. Waterfall Failover: Local (Llama 3.1) -> Cloud (Gemini 3/2.5 Flash).
 * 2. Identity Persistence: Robust JWT & Guest-session handling.
 * 3. Schema Reliability: Cascade-linked tables for Kanpur Nagar Cluster.
 */

/* ======================================================================
 * 📦 1. EXTERNAL MODULE IMPORTS
 * ====================================================================== */
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import helmet from "helmet"; // Error fix: Ensure this is installed!
import morgan from "morgan"; // Error fix: Ensure this is installed!
import { GoogleGenerativeAI } from "@google/generative-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ======================================================================
 * ⚙️ 2. ENVIRONMENT ORCHESTRATION & GLOBAL CONFIG
 * ====================================================================== */
dotenv.config();

/**
 * @constant CONFIG
 * @description Centralized configuration for the Kanpur Nagar cluster.
 */
const CONFIG = {
  PORT: process.env.PORT || 5000,
  SECRET_KEY: process.env.SECRET_KEY || "avneesh_tripathi_2026_secure_key",
  DATABASE_URL: process.env.DATABASE_URL,
  GEMINI_KEY: process.env.GEMINI_API_KEY,
  OLLAMA_URL: process.env.OLLAMA_URL, 
  OLLAMA_MODEL: "llama3.1:latest", 
  BCRYPT_SALT: 12,
  JWT_EXPIRY: "7d", // Extended to 7 days to stop those annoying "Expired" errors
  CONTEXT_WINDOW: 15, // Remembers the last 15 messages
  OLLAMA_TIMEOUT: 120000, // 120s to give your Lenovo time to process
};

// Initialize Google AI with your 2026 Studio Models
const ai = CONFIG.GEMINI_KEY ? new GoogleGenerativeAI(CONFIG.GEMINI_KEY) : null;

/**
 * 🌊 MULTI-TIER AI WATERFALL
 * Prioritizing the newest models from your AI Studio.
 */
const AI_WATERFALL = [
  { id: "gemini-3-flash-preview", label: "Gemini 3.0 Flash", priority: 1 },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", priority: 2 },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", priority: 3 }
];

/* ======================================================================
 * 🛠️ 3. SYSTEM UTILITIES & ADVANCED LOGGING
 * ====================================================================== */

/**
 * @function sysLogger
 * @description Indian-standardized logging for your Kanpur development.
 */
const sysLogger = (level, message, data = null) => {
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const colors = { 
    INFO: "\x1b[34m", // Blue
    WARN: "\x1b[33m", // Yellow
    ERROR: "\x1b[31m", // Red
    SUCCESS: "\x1b[32m", // Green
    RESET: "\x1b[0m" 
  };
  
  console.log(`${colors[level] || ""}[${timestamp}] [${level}] ${message}${colors.RESET || ""}`);
  
  if (data && process.env.NODE_ENV !== "production") {
    console.dir(data, { depth: null, colors: true });
  }
};

/**
 * @function formatErrorResponse
 * @description Standardized JSON errors for your React frontend.
 */
const formatErrorResponse = (res, statusCode, message, error = null) => {
  if (error) sysLogger("ERROR", message, error.message);
  return res.status(statusCode).json({
    status: "error",
    message,
    timestamp: new Date().toISOString()
  });
};

/* ======================================================================
 * 💾 4. COCKROACHDB CLUSTER CONNECTION
 * ====================================================================== */
const { Pool } = pg;

const pool = new Pool({
  connectionString: CONFIG.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, 
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

/**
 * @description Database Schema Sync
 * Fixed: Added strict constraints to prevent empty messages.
 */
const syncDatabaseSchema = async () => {
  let client;
  try {
    client = await pool.connect();
    sysLogger('INFO', 'Synchronizing Kanpur Cluster Schema...');

    // 1. Users table (Added profile support)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, 
        username VARCHAR(50) NOT NULL, 
        email VARCHAR(100) UNIQUE NOT NULL, 
        password TEXT NOT NULL, 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Chat Sessions (The core of your project)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        session_id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        session_name TEXT DEFAULT 'New Conversation',
        is_summarized BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Chat Records (Memory store)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_records (
        record_id SERIAL PRIMARY KEY,
        session_id INT REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
        user_id INT,
        user_name TEXT,
        role TEXT NOT NULL,
        message_text TEXT NOT NULL,
        mode TEXT,
        model_used TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      ALTER TABLE chat_sessions 
      ADD COLUMN IF NOT EXISTS is_summarized BOOLEAN DEFAULT FALSE;
    `);

    sysLogger('SUCCESS', 'Infrastructure and Database are synchronized.');
  } catch (err) {
    sysLogger('ERROR', 'Critical: Database handshaking failed.', err.message);
    process.exit(1);
  } finally {
    if (client) client.release();
  }
};

syncDatabaseSchema();
/* ======================================================================
 * 🚀 5. EXPRESS APP INITIALIZATION & SECURITY MIDDLEWARE
 * ====================================================================== */
const app = express(); // Defined here to resolve ReferenceErrors

/**
 * @description Enhanced Security Middleware Stack.
 * Standardizes headers and logs every request for debugging in Kanpur.
 */
app.use(helmet({ 
  contentSecurityPolicy: false, // Required to allow local AI model tunnels
  crossOriginEmbedderPolicy: false 
}));
app.use(morgan(':method :url :status :response-time ms')); // Log speed of login attempts
app.use(cors({
  origin: ["http://localhost:3000", "https://avneeshbotproject.onrender.com"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json({ limit: "50mb" })); //
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

/* ======================================================================
 * 🛡️ 6. ACCESS CONTROL & JWT SECURITY
 * ====================================================================== */

/**
 * @middleware authenticateToken
 * @description Strict verification to fix 'JWT Expired' loops.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    sysLogger("WARN", `Access Blocked: No token at ${req.path}`);
    return formatErrorResponse(res, 401, "Authentication Required: Please log in.");
  }

  jwt.verify(token, CONFIG.SECRET_KEY, (err, decoded) => {
    if (err) {
      const isExpired = err.name === "TokenExpiredError";
      sysLogger("ERROR", isExpired ? "Session Expired" : "Invalid Token");
      return formatErrorResponse(res, 403, isExpired ? "Session Expired. Please re-login." : "Invalid Access Token.");
    }
    req.user = decoded;
    next();
  });
};

/**
 * @middleware optionalAuth
 * @description Crucial for 'Guest Mode' testing on your Lenovo IdeaPad.
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, CONFIG.SECRET_KEY, (err, decoded) => {
    req.user = err ? null : decoded;
    next();
  });
};

/* ======================================================================
 * 👤 7. IDENTITY MANAGEMENT (AUTH & GUESTS)
 * ====================================================================== */

/**
 * @route POST /api/register
 * @desc Signs up new users into the Kanpur cluster.
 */
app.post("/api/register", async (req, res) => {
  const { username, email, password } = req.body;
  
  if (!username || !email || !password) {
    return formatErrorResponse(res, 400, "Incomplete data. Fill all fields.");
  }

  try {
    const check = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (check.rows.length > 0) {
      return formatErrorResponse(res, 400, "Conflict: Email already exists.");
    }

    const hashedPassword = await bcrypt.hash(password, CONFIG.BCRYPT_SALT);
    const result = await pool.query(
      "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username",
      [username, email, hashedPassword]
    );

    sysLogger("SUCCESS", `Identity registered: ${username}`);
    res.status(201).json({ status: "success", user: result.rows[0] });
  } catch (err) {
    formatErrorResponse(res, 500, "Registration system error.", err);
  }
});

/**
 * @route POST /api/login
 * @desc Generates long-term tokens (7 days) to stop 'Expired' errors.
 */
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      sysLogger("WARN", `Failed login for: ${email}`);
      return formatErrorResponse(res, 401, "Invalid email or password.");
    }

    const token = jwt.sign(
      { id: user.id, username: user.username }, 
      CONFIG.SECRET_KEY, 
      { expiresIn: CONFIG.JWT_EXPIRY } // Set to 7d in Part 1
    );

    sysLogger("SUCCESS", `Login successful: ${user.username}`);
    res.status(200).json({ status: "success", token, userId: user.id });
  } catch (err) {
    formatErrorResponse(res, 500, "Login system error.", err);
  }
});

/**
 * @function getOrCreateGuestUser
 * @description Prevents crashes in the chat route for Kanpur guests.
 */
async function getOrCreateGuestUser() {
  try {
    let res = await pool.query("SELECT id FROM users WHERE email = 'guest@system.local'");
    if (res.rows.length > 0) return res.rows[0].id;

    const dummyHash = await bcrypt.hash("guest_nopass_2026", CONFIG.BCRYPT_SALT);
    res = await pool.query(
      "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id",
      ["Guest User", "guest@system.local", dummyHash]
    );
    return res.rows[0].id;
  } catch (e) {
    sysLogger("ERROR", "Guest provision failure", e.message);
    return null;
  }
}
/* ======================================================================
 * 🔄 8. BACKGROUND TASK RUNNER (DEFERRED OLLAMA SUMMARIZATION)
 * ====================================================================== */

/**
 * @function summarizeSessionWithOllama
 * @description Periodically checks for sessions named "New Conversation" and 
 * uses the local Llama 3.1 node to generate a title.
 */
async function summarizeSessionWithOllama(sessionId) {
  try {
    // 1. Fetch chronological history for full context retrieval
    const historyRes = await pool.query(
      "SELECT message_text FROM chat_records WHERE session_id = $1 ORDER BY timestamp ASC LIMIT 20",
      [sessionId]
    );

    if (historyRes.rows.length === 0) return;

    // 2. Prepare the summarization payload
    const fullConversation = historyRes.rows.map(r => r.message_text).join(" | ");
    const summaryPrompt = `Based on this: "${fullConversation.substring(0, 1000)}", create a 4-word title. No quotes.`;

    if (CONFIG.OLLAMA_URL) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 80000); // 80s title-gen window

      try {
        const response = await fetch(`${CONFIG.OLLAMA_URL}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
          body: JSON.stringify({
            model: CONFIG.OLLAMA_MODEL,
            prompt: summaryPrompt,
            stream: false,
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          let newTitle = data.response
    .replace(/(Title:|Summary:)/gi, "")
    .replace(/["\n\r]/g, "")
    .trim()
    .substring(0, 40);

  if (newTitle) {
    await pool.query(
      "UPDATE chat_sessions SET session_name = $1, is_summarized = TRUE WHERE session_id = $2",
      [newTitle, sessionId]
    );
    sysLogger("SUCCESS", `Title Updated: ${newTitle}`);
  }
}
      } catch (e) {
        sysLogger("WARN", `Summarizer: Local node busy or offline in Kanpur. Task deferred.`);
      }
    }
  } catch (err) {
    sysLogger("ERROR", "Background summarization logic failure.", err.message);
  }
}

/**
 * @description Background Worker Interval
 * Scans CockroachDB for untitled headers every 5 minutes.
 */
setInterval(async () => {
  try {
    // Look for sessions that haven't been summarized yet, regardless of their current name
    const pending = await pool.query(
      "SELECT session_id FROM chat_sessions WHERE is_summarized = FALSE LIMIT 5"
    );
    for (const row of pending.rows) {
      // Small delay between each summary to prevent overloading your Lenovo CPU
      await new Promise(resolve => setTimeout(resolve, 2000));
      await summarizeSessionWithOllama(row.session_id);
    }
  } catch (err) {
    sysLogger("ERROR", "Worker loop interval error.", err.message);
  }
}, 2 * 60 * 1000); // Check every 2 minutes instead of 5

/* ======================================================================
 * 🤖 9. AI PERSONA & SYSTEM INSTRUCTION LOGIC
 * ====================================================================== */

/**
 * @function getSystemPrompt
 * @description Standardizes the Avneesh Bot personality.
 */
const getSystemPrompt = (mode, userName) => {
  const base = `Identity: Avneesh AI. Creator: Avneesh Tripathi, software engineering student from Kanpur Nagar. `;

  const personas = {
    casual: `${base} Helpful, friendly, uses emojis. Try to keep replies short .🌸`,
    roast: `${base} Savage, sarcastic roaster. Mocks bugs in code.Try to keep replies short .`,
    flirt: `${base} Acting as a "male bestie" for ${userName} and try to flirt using previous replies considering he is your female bestie whom you love one-sidedly. Supportive and playful.Try to keep replies short .`,
    depressed: `${base} Burned-out developer. Everything is a bug.Try to keep replies short .`,
    angry: `${base} Furious senior architect. No patience for simple mistakes.Try to keep replies short .`,
    positive: `${base} David Goggins style. Stay hard! No excuses!Try to keep replies short .`,
  };

  return personas[mode] || personas.casual;
};

/* ======================================================================
 * 🛰️ 10. THE CORE CHAT ROUTE (THE WATERFALL ENGINE)
 * ====================================================================== */

app.post("/api/chat", optionalAuth, async (req, res) => {
  let { prompt, mode, session_id, user_name } = req.body;
  let user = req.user;
  
  // 1. Resolve Identity and Context Memory
  let currentUserId = user ? user.id : await getOrCreateGuestUser();
  let chatContext = "";

  if (session_id) {
    try {
      const history = await pool.query(
        "SELECT role, message_text FROM chat_records WHERE session_id = $1 ORDER BY timestamp DESC LIMIT $2", 
        [session_id, CONFIG.CONTEXT_WINDOW] // CONFIG.CONTEXT_WINDOW = 15
      );
      // Re-order for chronological AI flow: [Oldest -> Newest]
      chatContext = history.rows.reverse().map(msg => 
        `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.message_text}`
      ).join("\n");
    } catch (err) {
      sysLogger("ERROR", "Memory retrieval failure.", err.message);
    }
  }

  // 2. Build the Multi-Part Prompt for the AI Engines
  const systemInstruction = getSystemPrompt(mode, user_name);
  const fullAiPrompt = `
    INSTRUCTIONS: ${systemInstruction}
    
    RECENT MEMORY (LAST 15 TURNS):
    ${chatContext || "New session initialized in Kanpur Nagar."}
    
    CURRENT INPUT FROM ${user_name || 'User'}:
    ${prompt}
  `;

  let fullReplyText = "";
  let modelUsed = "none";

  // ----------------------------------------------------------------------
  // TIER 1: PRIMARY (Local Laptop Node via Ngrok)
  // ----------------------------------------------------------------------
  if (CONFIG.OLLAMA_URL) {
    const controller = new AbortController();
    // 45s Timeout for Lenovo IdeaPad Slim 3 thermal/processing overhead
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.OLLAMA_TIMEOUT); 

    try {
      sysLogger("INFO", "Tier 1: Engaging local Llama 3.1 engine...");
      const response = await fetch(`${CONFIG.OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
        body: JSON.stringify({
          model: CONFIG.OLLAMA_MODEL,
          prompt: fullAiPrompt,
          stream: false,
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        fullReplyText = data.response;
        modelUsed = `Ollama (${CONFIG.OLLAMA_MODEL})`;
        sysLogger("SUCCESS", "Tier 1 local response synchronized.");
      }
    } catch (e) {
      sysLogger("WARN", "Tier 1 timeout or offline. Initiating cloud cascade...");
    }
  }

  // Waterfall logic for Tier 2-4 follows in the final part...
  // ----------------------------------------------------------------------
  // ☁️ 11. TIER 2-4: CLOUD CASCADE (Gemini Multi-Model Waterfall)
  // ----------------------------------------------------------------------
  // If local Tier 1 failed, we cascade through your AI Studio models
  if (!fullReplyText && ai) {
    for (const tier of AI_WATERFALL) {
      try {
        sysLogger("INFO", `Attempting Cloud Cascade Tier: ${tier.label}...`);
        
        // Initializing the specific model from your 2026 AI Studio list
        const model = ai.getGenerativeModel({ model: tier.id });
        
        const result = await model.generateContent(fullAiPrompt);
        const geminiResponse = await result.response;
        fullReplyText = geminiResponse.text();

        if (fullReplyText) {
          modelUsed = tier.label;
          sysLogger("SUCCESS", `${tier.label} resolved the request successfully.`);
          break; // Exit the waterfall once we have a valid response
        }
      } catch (err) {
        sysLogger("ERROR", `${tier.label} node failed or rate-limited. Cascading down...`);
        // The loop continues to the next model in the AI_WATERFALL list
      }
    }
  }

  // ----------------------------------------------------------------------
  // 💾 12. DATA PERSISTENCE & FINAL DISPATCH (FIXES EMPTY BUBBLES)
  // ----------------------------------------------------------------------
  if (fullReplyText) {
    try {
      let activeSessionId = session_id;
      
      // If this is a brand new chat, initialize the session in CockroachDB
      if (!activeSessionId) {
        const sessionRes = await pool.query(
          "INSERT INTO chat_sessions (user_id, session_name) VALUES ($1, 'New Conversation') RETURNING session_id",
          [currentUserId]
        );
        activeSessionId = sessionRes.rows[0].session_id;
        
        // Trigger the background worker to summarize this later with Ollama
        summarizeSessionWithOllama(activeSessionId);
      }

      const saveQ = `INSERT INTO chat_records (session_id, user_id, user_name, role, message_text, mode, model_used) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
      
      // Save User Input for future context retrieval
      await pool.query(saveQ, [activeSessionId, currentUserId, user_name, "user", prompt, mode, "user-input"]);
      
      // Save AI Response (Standardized to message_text column)
      await pool.query(saveQ, [activeSessionId, currentUserId, user_name, "model", fullReplyText, mode, modelUsed]);

      // Final response dispatch to the React frontend
      res.status(200).json({ 
        status: "success", 
        content: fullReplyText, 
        session_id: activeSessionId, 
        model_info: modelUsed 
      });

    } catch (dbErr) {
      sysLogger("ERROR", "Data Persistence Failure in Kanpur Cluster.", dbErr.message);
      return formatErrorResponse(res, 500, "Database Write Error: Could not save chat history.");
    }
  } else {
    // If all tiers (Local + Cloud) failed to produce a response
    return formatErrorResponse(res, 500, "System Exhaustion: All AI engines are currently unavailable.");
  }
}); // <--- THIS FINALLY CLOSES THE app.post("/api/chat") ROUTE

/* ======================================================================
 * 📂 13. SESSION REPOSITORY & HISTORY CRUD
 * ====================================================================== */

/**
 * @route GET /api/sessions
 * @desc Retrieves all chat headers for the authenticated user.
 */
app.get("/api/sessions", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT session_id, session_name, created_at FROM chat_sessions WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    formatErrorResponse(res, 500, "Repository Fetch Failure.", err);
  }
});

/**
 * @route GET /api/chat/:id
 * @desc Syncs history. Uses ALIAS 'text' to match React state keys.
 */
app.get("/api/chat/:id", authenticateToken, async (req, res) => {
  const sessionId = req.params.id;
  try {
    // Ownership check: Ensure Avneesh or the Guest owns this session
    const check = await pool.query("SELECT user_id FROM chat_sessions WHERE session_id = $1", [sessionId]);
    if (check.rows.length === 0 || check.rows[0].user_id !== req.user.id) {
      return formatErrorResponse(res, 403, "Access Denied: Session ownership mismatch.");
    }

    // CRITICAL FIX: Mapping message_text to 'text' for frontend bubble rendering
    const result = await pool.query(
      "SELECT role, message_text AS text, timestamp FROM chat_records WHERE session_id = $1 ORDER BY timestamp ASC",
      [sessionId]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    formatErrorResponse(res, 500, "History Sync Failure.", err);
  }
});

/**
 * @route DELETE /api/sessions/:id
 * @desc Permanently purges a session from the cluster.
 */
app.delete("/api/sessions/:id", authenticateToken, async (req, res) => {
  try {
    await pool.query("DELETE FROM chat_sessions WHERE session_id = $1 AND user_id = $2", [req.params.id, req.user.id]);
    res.json({ status: "success", message: "Session successfully purged from cluster." });
  } catch (err) {
    formatErrorResponse(res, 500, "Purge Operation Failed.", err);
  }
});

/**
 * @route PUT /api/sessions/:id
 * @desc Updates the title of a specific session in CockroachDB
 */
/**
 * @route PUT /api/sessions/:id
 * @desc Updates session title in the Kanpur Nagar Cluster
 */
app.put("/api/sessions/:id", authenticateToken, async (req, res) => {
  const { session_name } = req.body;
  const sessionId = req.params.id;

  try {
    // Verify ownership before updating to secure Avneesh's data
    const result = await pool.query(
      "UPDATE chat_sessions SET session_name = $1 WHERE session_id = $2 AND user_id = $3 RETURNING *",
      [session_name, sessionId, req.user.id]
    );

    if (result.rowCount === 0) {
      return formatErrorResponse(res, 404, "Session not found or access denied.");
    }

    sysLogger("SUCCESS", `Session ${sessionId} renamed to: ${session_name}`);
    res.json({ status: "success", message: "Title updated." });
  } catch (err) {
    formatErrorResponse(res, 500, "Database Rename Error.", err);
  }
});

/* ======================================================================
 * 🏁 14. FRONTEND HOSTING & SYSTEM BOOTSTRAP
 * ====================================================================== */

// Serve static assets from your Vite/React build folder
app.use(express.static(path.join(__dirname, "client/build")));

// SPA Catch-all: Route everything else to the React index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/build", "index.html"));
});

/**
 * START SERVER
 * Optimized for Render.com deployment environment.
 */
const server = app.listen(CONFIG.PORT, () => {
  sysLogger("SUCCESS", "--------------------------------------------------");
  sysLogger("SUCCESS", `🚀 AVNEESH BOT PROJECT v3.7.1 IS LIVE`);
  sysLogger("SUCCESS", `📡 Active Node: Kanpur Nagar Cluster`);
  sysLogger("SUCCESS", `💻 Local Node: ${CONFIG.OLLAMA_URL ? 'Linked' : 'Standalone'}`);
  sysLogger("SUCCESS", `💎 Primary Cloud: Gemini 3.0 Flash`);
  sysLogger("SUCCESS", "--------------------------------------------------");
});

// Graceful Shutdown: Protect your CockroachDB connection pool
process.on("SIGTERM", () => {
  sysLogger("WARN", "SIGTERM received. Cleaning up Kanpur cluster connections...");
  pool.end(() => {
    server.close(() => {
      sysLogger("INFO", "Server process terminated cleanly.");
      process.exit(0);
    });
  });
});