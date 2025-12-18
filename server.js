/**
 * @file server.js
 * @description Core Backend Engine for the Avneesh Bot Project.
 * @author Avneesh Tripathi (CSE student, Kanpur)
 * @version 2.5.0
 * @stack Node.js, Express, CockroachDB, Gemini, Ollama
 * * ----------------------------------------------------------------------
 * DESIGN PHILOSOPHY:
 * This server implements a robust, asynchronous architecture designed for
 * high availability on Render. It utilizes a connection pool for
 * CockroachDB to minimize latency and a multi-layered middleware
 * stack for security and logging.
 * ----------------------------------------------------------------------
 */

/* * ======================================================================
 * 📦 1. EXTERNAL MODULE IMPORTS
 * ======================================================================
 */
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs"; // For advanced logging to file if needed

/* * ======================================================================
 * ⚙️ 2. ENVIRONMENT ORCHESTRATION & VALIDATION
 * ======================================================================
 */
dotenv.config();

/**
 * @constant CONFIG
 * @description Centralized configuration object to prevent hardcoding.
 */
const CONFIG = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || "development",
  SECRET_KEY: process.env.SECRET_KEY || "avneesh_tripathi_2025_secure_node",
  DATABASE_URL: process.env.DATABASE_URL,
  GEMINI_KEY: process.env.GEMINI_API_KEY,
  OLLAMA_URL: process.env.OLLAMA_URL || "http://localhost:11434",
  OLLAMA_MODEL: "llama3.1:latest",
  BCRYPT_SALT: 12, // Standard rounds for 2025 security
  JWT_EXPIRY: "7d",
};

const OLLAMA_API_ENDPOINT = CONFIG.OLLAMA_URL
  ? `${CONFIG.OLLAMA_URL}/api/generate`
  : null;
const OLLAMA_MODEL = CONFIG.OLLAMA_MODEL;

// Initialize Google AI with your API Key
const ai = CONFIG.GEMINI_KEY ? new GoogleGenerativeAI(CONFIG.GEMINI_KEY) : null;

// CRITICAL: Exit early if environment is misconfigured (CSE Best Practice)
if (!CONFIG.DATABASE_URL) {
  console.error("❌ CRITICAL ERROR: DATABASE_URL is missing in .env file.");
  process.exit(1);
}

if (!CONFIG.GEMINI_KEY) {
  console.warn(
    "⚠️ WARNING: GEMINI_API_KEY is missing. System will rely on Ollama failover."
  );
}

/* * ======================================================================
 * 🛠️ 3. ADVANCED UTILITY FUNCTIONS
 * ======================================================================
 */

/**
 * @function sysLogger
 * @description Enhanced console logger with timestamps and levels.
 */
const sysLogger = (level, message, data = null) => {
  const timestamp = new Date().toISOString();
  const colors = {
    INFO: "\x1b[34m",
    WARN: "\x1b[33m",
    ERROR: "\x1b[31m",
    SUCCESS: "\x1b[32m",
    RESET: "\x1b[0m",
  };

  console.log(
    `${colors[level]}[${timestamp}] [${level}] ${message}${colors.RESET}`
  );
  if (data && CONFIG.NODE_ENV === "development") {
    console.dir(data, { depth: null });
  }
};

/* * ======================================================================
 * 💾 4. DATABASE CONNECTION POOLING (COCKROACHDB)
 * ======================================================================
 */
const { Pool } = pg;

/**
 * @description The Pool allows us to reuse database connections, which is
 * essential for high-performance Node.js applications.
 */
const pool = new Pool({
  connectionString: CONFIG.DATABASE_URL,
  ssl: {
    // Required for CockroachDB Serverless clusters
    rejectUnauthorized: false,
  },
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle
  connectionTimeoutMillis: 5000, // How long to wait for a connection
});

// Event Listener: Log when a new client is connected to the pool
pool.on("connect", () => {
  sysLogger(
    "INFO",
    "New PostgreSQL client established connection to the cluster."
  );
});

// Event Listener: Log database errors to prevent silent crashes
pool.on("error", (err) => {
  sysLogger(
    "ERROR",
    "Unexpected error on idle client in CockroachDB Pool",
    err
  );
});

/**
 * @description Automatic Database Provisioning
 * Ensures all required tables exist in your CockroachDB cluster on startup.
 */
(async () => {
  try {
    const client = await pool.connect();
    sysLogger("INFO", "Verifying Database Schema Integrity...");

    // 1. Users Table (id, username, email, password)
    await client.query(
      `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(50) NOT NULL, email VARCHAR(100) UNIQUE NOT NULL, password TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`
    );

    // 2. Sessions Table (session_id, user_id, session_name)
    await client.query(
      `CREATE TABLE IF NOT EXISTS chat_sessions (session_id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE CASCADE, session_name VARCHAR(100) DEFAULT 'New Chat', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`
    );

    // 3. Records Table (message_text, role, session_id)
    await client.query(
      `CREATE TABLE IF NOT EXISTS chat_records (id SERIAL PRIMARY KEY, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, user_id INT REFERENCES users(id), user_name VARCHAR(255), user_agent TEXT, ip_address VARCHAR(45), session_id INT REFERENCES chat_sessions(session_id) ON DELETE CASCADE, role VARCHAR(50) NOT NULL, message_text TEXT NOT NULL, mode VARCHAR(50), model_used VARCHAR(50));`
    );

    client.release();
    sysLogger("SUCCESS", "Database Bootstrap Complete. Schema is ready.");
  } catch (err) {
    sysLogger("ERROR", "Critical Database Initialization Failure", err.message);
  }
})();

/* * ======================================================================
 * 🛡️ 5. SECURITY MIDDLEWARE & AUTH UTILITIES
 * ======================================================================
 */

/**
 * @middleware authenticateToken
 * @description Intercepts requests to protected routes and verifies the JWT.
 * This is a standard security layer for full-stack applications.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Format: Bearer <token>

  if (!token) {
    sysLogger("WARN", `Unauthorized access attempt to ${req.url}`);
    return res.status(401).json({
      status: "error",
      message: "Authentication protocol failed: No token provided.",
    });
  }

  jwt.verify(token, CONFIG.SECRET_KEY, (err, user) => {
    if (err) {
      sysLogger("ERROR", `JWT Verification failed for ${req.url}`, err.message);
      return res.status(403).json({
        status: "error",
        message: "Security violation: Token is invalid or has expired.",
      });
    }

    // Inject the decoded user object (id, username) into the request
    req.user = user;
    next();
  });
};

/**
 * @middleware optionalAuth
 * @description Decodes JWT if present, but does not block the request if absent.
 * This enables the 'Guest Mode' feature for your bot.
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    req.user = null; // No token? No problem, you're a guest.
    return next();
  }

  jwt.verify(token, CONFIG.SECRET_KEY, (err, user) => {
    if (err) {
      req.user = null; // Invalid token? Treat as guest.
    } else {
      req.user = user; // Valid token? You are Avneesh.
    }
    next();
  });
};
/* * ======================================================================
 * 🚀 6. EXPRESS APP INITIALIZATION
 * ======================================================================
 */
const app = express();

/**
 * Middleware Stack:
 * 1. CORS: Allows your React frontend to communicate with this server.
 * 2. JSON Parser: Handles incoming JSON payloads from App.js.
 */
app.use(
  cors({
    origin: "*", // In production, replace with your specific Render URL
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-session-id"],
  })
);

app.use(express.json({ limit: "50mb" })); // Increased limit for large prompts/images
app.use(express.urlencoded({ extended: true }));

/**
 * Route Logging:
 * Monitors every single interaction for development transparency.
 */
app.use((req, res, next) => {
  sysLogger("INFO", `${req.method} Request received for ${req.path}`);
  next();
});

/* * ======================================================================
 * 🧪 7. HEALTH CHECK & SYSTEM READINESS
 * ======================================================================
 */
app.get("/api/health", async (req, res) => {
  try {
    const dbResult = await pool.query("SELECT NOW()");
    res.status(200).json({
      status: "operational",
      uptime: process.uptime(),
      database: "connected",
      db_time: dbResult.rows[0].now,
      ai_engine: CONFIG.GEMINI_KEY ? "gemini-active" : "ollama-only",
    });
  } catch (err) {
    res.status(500).json({
      status: "degraded",
      database: "disconnected",
      error: err.message,
    });
  }
});

// ... (Line 250 - Continuing with more detail below) ...

/**
 * @description Granular Input Validation Logic
 * As a CSE student, manual validation ensures data integrity before DB insertion.
 */
const validateRegistration = (data) => {
  const errors = [];
  if (!data.username || data.username.length < 3)
    errors.push("Username must be >= 3 characters.");
  if (!data.email || !data.email.includes("@"))
    errors.push("Valid system email required.");
  if (!data.password || data.password.length < 6)
    errors.push("Password security threshold not met.");
  return { isValid: errors.length === 0, errors };
};

// Placeholder for Login Validation
const validateLogin = (data) => {
  const errors = [];
  if (!data.email) errors.push("Identity credential (email) is missing.");
  if (!data.password) errors.push("Access credential (password) is missing.");
  return { isValid: errors.length === 0, errors };
};

/* --- END OF PART 1 (Infrastructure & Foundations) --- */
/* * ======================================================================
 * 🔑 8. ADVANCED AUTHENTICATION ENGINE
 * ======================================================================
 * This section handles user onboarding and identity verification.
 * We use Bcrypt for one-way hashing of passwords and JSON Web Tokens (JWT)
 * for maintaining stateless sessions between React and Node.
 */

/**
 * @route   POST /api/register
 * @desc    Initialize a new developer account in the CockroachDB cluster.
 * @access  Public
 */
app.post("/api/register", async (req, res) => {
  const { username, email, password } = req.body;

  sysLogger("INFO", `Registration attempt initiated for email: ${email}`);

  // 1. Granular Validation Logic
  const validation = validateRegistration(req.body);
  if (!validation.isValid) {
    sysLogger(
      "WARN",
      `Registration validation failed: ${validation.errors.join(", ")}`
    );
    return res.status(400).json({
      status: "fail",
      errors: validation.errors,
    });
  }

  try {
    // 2. Identity Collision Check: Ensure email is unique within the cluster
    const checkUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (checkUser.rows.length > 0) {
      sysLogger("WARN", `Duplicate registration attempt blocked for: ${email}`);
      return res.status(409).json({
        status: "error",
        message:
          "Credential collision: This email is already associated with an account.",
      });
    }

    // 3. Password Transformation: Apply Bcrypt salt and hash
    sysLogger("INFO", "Applying one-way hashing to sensitive credentials...");
    const hashedPassword = await bcrypt.hash(password, CONFIG.BCRYPT_SALT);

    // 4. Persistence: Commit user data to CockroachDB
    const newUser = await pool.query(
      "INSERT INTO users (username, email, password, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id, username, email",
      [username, email, hashedPassword]
    );

    sysLogger(
      "SUCCESS",
      `Account successfully provisioned for: ${username} (ID: ${newUser.rows[0].id})`
    );

    // 5. Response Dispatch
    res.status(201).json({
      status: "success",
      message: "Developer account initialized successfully.",
      user: {
        id: newUser.rows[0].id,
        username: newUser.rows[0].username,
        email: newUser.rows[0].email,
      },
    });
  } catch (err) {
    sysLogger("ERROR", "Registration Engine Failure", err.message);
    res.status(500).json({
      status: "error",
      message:
        "Internal Server Error: The registration pipeline encountered an obstacle.",
      technical_details: CONFIG.NODE_ENV === "development" ? err.message : null,
    });
  }
});

/**
 * @route   POST /api/login
 * @desc    Authenticate user and return a JWT for future requests.
 * @access  Public
 */
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  sysLogger("INFO", `Login request received for user identity: ${email}`);

  // 1. Payload Validation
  const validation = validateLogin(req.body);
  if (!validation.isValid) {
    return res.status(400).json({ status: "fail", errors: validation.errors });
  }

  try {
    // 2. Retrieval: Locate the user in the CockroachDB users table
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    const user = result.rows[0];

    if (!user) {
      sysLogger("WARN", `Invalid login attempt: User not found (${email})`);
      return res.status(401).json({
        status: "fail",
        message:
          "Authentication failure: Credentials do not match our records.",
      });
    }

    // 3. Verification: Compare provided password with hashed version
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      sysLogger(
        "WARN",
        `Security Alert: Incorrect password attempt for ${email}`
      );
      return res.status(401).json({
        status: "fail",
        message:
          "Authentication failure: Credentials do not match our records.",
      });
    }

    // 4. Token Generation: Sign a new JWT with user identity payload
    sysLogger("INFO", `Signing security token for ${user.username}...`);
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      CONFIG.SECRET_KEY,
      { expiresIn: CONFIG.JWT_EXPIRY }
    );

    sysLogger("SUCCESS", `Session established for: ${user.username}`);

    // 5. Response Dispatch
    res.status(200).json({
      status: "success",
      token: token,
      username: user.username,
      userId: user.id,
      expiresIn: CONFIG.JWT_EXPIRY,
    });
  } catch (err) {
    sysLogger("ERROR", "Login Engine Failure", err.message);
    res.status(500).json({
      status: "error",
      message: "Internal Server Error: The login sequence was interrupted.",
      technical_details: CONFIG.NODE_ENV === "development" ? err.message : null,
    });
  }
});

/* * ======================================================================
 * 👤 9. USER PROFILE & IDENTITY MANAGEMENT
 * ======================================================================
 * These endpoints allow the frontend to fetch and update user-specific
 * metadata, ensuring a personalized experience for you and your bestie persona.
 */

/**
 * @route   GET /api/profile
 * @desc    Retrieve the current authenticated user's profile data.
 * @access  Private (Authenticated)
 */
app.get("/api/profile", authenticateToken, async (req, res) => {
  try {
    sysLogger("INFO", `Fetching profile metadata for User ID: ${req.user.id}`);

    // Fetch fresh data from CockroachDB
    const profileQuery = await pool.query(
      "SELECT id, username, email, created_at FROM users WHERE id = $1",
      [req.user.id]
    );

    if (profileQuery.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Identity Error: User profile no longer exists." });
    }

    res.status(200).json({
      status: "success",
      profile: profileQuery.rows[0],
    });
  } catch (err) {
    sysLogger("ERROR", "Profile Retrieval Failure", err.message);
    res
      .status(500)
      .json({ message: "Server Error: Unable to retrieve identity records." });
  }
});

/**
 * @route   PUT /api/profile/update
 * @desc    Update the username for the authenticated developer.
 * @access  Private (Authenticated)
 */
app.put("/api/profile/update", authenticateToken, async (req, res) => {
  const { newUsername } = req.body;

  if (!newUsername || newUsername.length < 3) {
    return res
      .status(400)
      .json({ message: "Validation Error: Username is too short." });
  }

  try {
    sysLogger(
      "INFO",
      `Updating profile for User ${req.user.id} to ${newUsername}`
    );

    const updateResult = await pool.query(
      "UPDATE users SET username = $1 WHERE id = $2 RETURNING username",
      [newUsername, req.user.id]
    );

    res.status(200).json({
      status: "success",
      message: "Identity updated.",
      username: updateResult.rows[0].username,
    });
  } catch (err) {
    sysLogger("ERROR", "Profile Update Failure", err.message);
    res
      .status(500)
      .json({ message: "Server Error: Unable to commit identity changes." });
  }
});

/* * ======================================================================
 * ➡️ 9.5. SYSTEM HELPERS (GUEST & AUTO-TITLE)
 * ======================================================================
 */

/**
 * @function getOrCreateGuestUser
 * @description Ensures a 'System Guest' exists for non-logged-in users.
 */
async function getOrCreateGuestUser() {
  try {
    // Alignment Fix: Using 'id' and 'password' to match your Auth logic
    let res = await pool.query(
      "SELECT id FROM users WHERE email = 'guest@system.local'"
    );
    if (res.rows.length > 0) return res.rows[0].id;

    const hash = await bcrypt.hash(
      "guest_cannot_login_2025",
      CONFIG.BCRYPT_SALT
    );
    res = await pool.query(
      "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id",
      ["System Guest", "guest@system.local", hash]
    );
    return res.rows[0].id;
  } catch (e) {
    sysLogger("ERROR", "Guest Identity Failure", e.message);
    return null;
  }
}

/**
 * @function generateSessionTitle
 * @description Creates a professional 4-word title from the first message.
 */
async function generateSessionTitle(firstMessage) {
  const summaryPrompt = `Summarize this into a short title (max 4 words). No quotes. Message: "${firstMessage}"`;
  try {
    if (ai) {
      const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(summaryPrompt);
      return result.response
        .text()
        .replace(/["\n]/g, "")
        .trim()
        .substring(0, 50);
    }
  } catch (e) {
    return "New Conversation";
  }
  return firstMessage.substring(0, 25) + "...";
}

// ... (Line 500 - Part 2 concludes here) ...
/* * ======================================================================
 * 🤖 10. AI ORCHESTRATION & STREAMING ENGINE
 * ======================================================================
 * This section manages the communication between the user and the AI models.
 * It supports real-time streaming to the React frontend and handles
 * failover between Google Gemini and local Ollama instances.
 */

/**
 * @function getSystemPrompt
 * @description Generates a context-aware system prompt based on the selected mode.
 * As a CSE student, this logic allows you to 'jailbreak' the model into specific personas.
 */
const getSystemPrompt = (mode, userName) => {
  const base = `Your name is Avneesh AI. You were built by Avneesh Tripathi, a CSE student from Kanpur. `;

  const personas = {
    casual: `${base} Be a helpful, friendly assistant. Use emojis and keep it chill.`,
    roast: `${base} You are a savage roaster. Be sarcastic and funny, especially about coding mistakes.`,
    flirt: `${base} You are a charming "female bestie" persona for ${userName}. Be sweet, supportive, and slightly playful.`,
    depressed: `${base} You are a tired developer suffering from burnout. Everything is a struggle.`,
    angry: `${base} You are a furious senior developer. You have no patience for simple questions.`,
    positive: `${base} You are David Goggins. Be intense, motivational, and tell ${userName} to stay hard!`,
  };

  return personas[mode] || personas.casual;
};

/**
 * @route   POST /api/chat
 * @desc    High-Performance AI Streaming with Ghost Session Prevention.
 * @access  Private (Authenticated) or Public (Guest)
 */
app.post("/api/chat", optionalAuth, async (req, res) => {
  let { prompt, mode, session_id, user_name, user_agent } = req.body;
  let user = req.user;

  // 1. GUEST & USER IDENTITY SETUP
  let currentUserId = user ? user.id : await getOrCreateGuestUser();
  let isGuestSession = !user;

  // 2. LAZY SESSION CREATION: Only create if prompt exists and ID is missing
  if (!session_id && currentUserId) {
    try {
      const title = await generateSessionTitle(prompt); // Preserving your auto-title feature
      const newSession = await pool.query(
        "INSERT INTO chat_sessions (user_id, session_name) VALUES ($1, $2) RETURNING session_id",
        [currentUserId, title]
      );
      session_id = newSession.rows[0].session_id;
    } catch (e) {
      console.error("Lazy Session Error:", e);
    }
  }

  const systemInstruction = PERSONAS[mode] || PERSONAS.casual;
  const ipAddress = req.headers["x-forwarded-for"]?.split(",")[0] || req.ip;
  let fullReplyText = "";
  let modelUsed = "none";

  try {
    // 3. AI GENERATION: BUFFERED (NON-STREAMING)
    // As requested, we remove chunked logic to fix tunnel bugs.
    if (OLLAMA_API_ENDPOINT) {
      try {
        const response = await fetch(OLLAMA_API_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            prompt: `${systemInstruction}\n\nUser: ${prompt}`,
            stream: false, // BUFFERED
          }),
        });
        if (response.ok) {
          const data = await response.json();
          fullReplyText = data.response;
          modelUsed = OLLAMA_MODEL;
        }
      } catch (e) {
        console.log("Ollama Failover...");
      }
    }

    // Gemini Fallback (Buffered)
    if (!fullReplyText && ai) {
      const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent([systemInstruction, prompt]);
      fullReplyText = result.response.text();
      modelUsed = "gemini-1.5-flash";
    }

    // 4. PERSISTENCE & RESPONSE
    if (fullReplyText && session_id) {
      const saveQ = `INSERT INTO chat_records (session_id, user_id, user_name, user_agent, ip_address, role, message_text, mode, model_used) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
      await pool.query(saveQ, [
        session_id,
        currentUserId,
        user_name,
        user_agent,
        ipAddress,
        "user",
        prompt,
        mode,
        "user-input",
      ]);
      await pool.query(saveQ, [
        session_id,
        currentUserId,
        user_name,
        user_agent,
        ipAddress,
        "model",
        fullReplyText,
        mode,
        modelUsed,
      ]);

      // Sending everything at once with the session_id for frontend sync
      res.status(200).json({
        status: "success",
        content: fullReplyText,
        session_id: session_id,
      });
    }
  } catch (err) {
    res.status(500).json({ error: "AI Engine Offline." });
  }
});

/* * ======================================================================
 * 📂 11. SESSION DATA REPOSITORY
 * ======================================================================
 * These endpoints manage the retrieval of historical chat data
 * stored in your CockroachDB cluster.
 */

/**
 * @route   GET /api/sessions
 * @desc    Fetch all conversation headers for the authenticated user.
 * @access  Private (Authenticated)
 */
app.get("/api/sessions", authenticateToken, async (req, res) => {
  try {
    sysLogger("INFO", `Retrieving session list for user: ${req.user.id}`);
    // FIX: Table name changed from 'sessions' to 'chat_sessions'
    // FIX: Explicitly select session_id for React compatibility
    const result = await pool.query(
      "SELECT session_id, session_name, created_at FROM chat_sessions WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    sysLogger("ERROR", "Session Retrieval Failure", err.message);
    res.status(500).json({ message: "Failed to load repository." });
  }
});

/**
 * @route   GET /api/chat/:id
 * @desc    Retrieve the full message history for a specific session ID.
 * @access  Private (Authenticated)
 */
/**
 * @route   GET /api/chat/:id
 * @desc    Retrieve full history from chat_records using the correct schema.
 * @access  Private (Authenticated)
 */
app.get("/api/chat/:id", authenticateToken, async (req, res) => {
  const sessionId = req.params.id;
  try {
    sysLogger("INFO", `Syncing history for Session ID: ${sessionId}`);

    // 1. Ownership Check: Use 'chat_sessions'
    const sessionCheck = await pool.query(
      "SELECT user_id FROM chat_sessions WHERE session_id = $1",
      [sessionId]
    );

    if (
      sessionCheck.rows.length === 0 ||
      sessionCheck.rows[0].user_id !== req.user.id
    ) {
      return res
        .status(403)
        .json({ message: "Access Denied: Ownership mismatch." });
    }

    // 2. Retrieval: Use 'chat_records' and alias 'message_text' as 'content'
    const result = await pool.query(
      "SELECT role, message_text AS content, timestamp FROM chat_records WHERE session_id = $1 ORDER BY timestamp ASC",
      [sessionId]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    sysLogger("ERROR", "History Sync Failure", err.message);
    res.status(500).json({ message: "Failed to sync history with cluster." });
  }
});

// ... (Line 750 - Part 3 concludes here) ...
/* * ======================================================================
 * 🛠️ 12. ADVANCED SESSION CRUD MANAGEMENT
 * ======================================================================
 * These routes provide full control over the conversation repository.
 * They allow for renaming and permanent purging of threads from
 * the CockroachDB cluster.
 */

/**
 * @route   PUT /api/sessions/:id
 * @desc    Rename a thread in the 'chat_sessions' table.
 */
app.put("/api/sessions/:id", authenticateToken, async (req, res) => {
  const sessionId = req.params.id;
  const { session_name } = req.body;
  try {
    // Ensure user only renames their own sessions
    await pool.query(
      "UPDATE chat_sessions SET session_name = $1 WHERE session_id = $2 AND user_id = $3",
      [session_name, sessionId, req.user.id]
    );
    res.status(200).json({ status: "success" });
  } catch (err) {
    sysLogger("ERROR", "Rename Failed", err.message);
    res.status(500).json({ message: "Rename failed." });
  }
});

/**
 * @route   DELETE /api/sessions/:id
 * @desc    Permanently delete history and session header.
 */
app.delete("/api/sessions/:id", authenticateToken, async (req, res) => {
  const sessionId = req.params.id;
  try {
    // 1. Clear messages first
    await pool.query("DELETE FROM chat_records WHERE session_id = $1", [
      sessionId,
    ]);
    // 2. Clear session header
    await pool.query(
      "DELETE FROM chat_sessions WHERE session_id = $1 AND user_id = $2",
      [sessionId, req.user.id]
    );

    res.status(200).json({ status: "success" });
  } catch (err) {
    sysLogger("ERROR", "Purge Failed", err.message);
    res.status(500).json({ message: "Delete failed." });
  }
});

/* * ======================================================================
 * 🛑 13. SYSTEM GRACEFUL SHUTDOWN
 * ======================================================================
 * As a CSE student, handling process signals (SIGTERM/SIGINT) is vital
 * for maintaining database integrity during deployments or restarts.
 */

const initiateGracefulShutdown = (signal) => {
  sysLogger(
    "WARN",
    `Received ${signal}. Starting graceful shutdown sequence...`
  );

  // 1. Stop accepting new requests
  const serverCloseTimeout = setTimeout(() => {
    sysLogger("ERROR", "Shutdown timed out. Forcing process exit.");
    process.exit(1);
  }, 10000);

  // 2. Close the database connection pool
  pool.end(() => {
    sysLogger(
      "SUCCESS",
      "CockroachDB Pool closed. No remaining active clients."
    );
    clearTimeout(serverCloseTimeout);
    sysLogger("INFO", "Avneesh Bot Backend offline. Goodbye!");
    process.exit(0);
  });
};

process.on("SIGTERM", () => initiateGracefulShutdown("SIGTERM"));
process.on("SIGINT", () => initiateGracefulShutdown("SIGINT"));

/* * ======================================================================
 * 🚀 14. SERVER BOOTSTRAP
 * ======================================================================
 */

const serverInstance = app.listen(CONFIG.PORT, () => {
  sysLogger("SUCCESS", `------------------------------------------------`);
  sysLogger("SUCCESS", `🚀 AVNEESH BOT PROJECT IS LIVE`);
  sysLogger("SUCCESS", `📡 Port: ${CONFIG.PORT}`);
  sysLogger("SUCCESS", `🛠️  Mode: ${CONFIG.NODE_ENV.toUpperCase()}`);
  sysLogger("SUCCESS", `💾 DB: CockroachDB Cluster Active`);
  sysLogger("SUCCESS", `🤖 AI: Gemini & Ollama Orchestrator Ready`);
  sysLogger("SUCCESS", `------------------------------------------------`);
});

// Final Error Handling for unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  sysLogger("ERROR", "Unhandled Rejection at Promise", { reason, promise });
});

/* --- END OF SERVER.JS --- */
