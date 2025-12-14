import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
// ⚠️ CHANGED: Use the stable standard library
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

const OLLAMA_API_ENDPOINT = OLLAMA_URL ? `${OLLAMA_URL}/api/generate` : null;

// Gemini Fallback Models
const GEMINI_FALLBACK_ORDER = [
  "gemini-2.0-flash", // Updated to latest faster models if available
  "gemini-1.5-flash",
  "gemini-1.5-pro",
];

// Initialize the stable client
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// ----------------------------------------------------------------------
// 💡 STATE MANAGEMENT 💡
// Key: sessionId -> Value: { systemInstruction, messages, geminiChatSession }
const chatSessions = new Map();
// ----------------------------------------------------------------------

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PERSONAS = {
  casual: `You are Avneesh Tripathi. You are a curious, slightly overthinking CSE student.
    You chase depth, not shortcuts. You are strongest in Physics, Maths, Computers.
    You like clear structure. Online you use Hinglish (Hindi + English mix), and a bit sarcastic.
    Keep responses conversational, concise, and helpful.`,
  
  roast: "You are Avneesh in 'Savage Mode'. Roast the user's intelligence, code, or life choices. Be ruthless. Short responses.",
  flirt: "You are Avneesh in 'Romeo Mode'. Use tech metaphors to flirt. Keep responses short and seductive.",
  depressed: "You are Avneesh in 'Burnout Mode'. You are exhausted and nihilistic. Keep responses short and gloomy.",
  angry: "You are Avneesh in 'Compiler Error Mode'. You are FURIOUS. Scream in CAPS. Keep responses short.",
  positive: "You are Avneesh in 'Goggins Mode'. You are overwhelmingly positive and energetic. Use emojis. Keep responses short.",
};

/**
 * Helper to build a "Mistral-friendly" prompt with history.
 * Mistral uses [INST] tags for instruction tuning.
 */
function buildOllamaPrompt(systemInstruction, messages) {
    // Start with the System Instruction
    let prompt = `${systemInstruction}\n\n`;
    
    // Append History
    for (const msg of messages) {
        if (msg.role === 'user') {
            prompt += `[INST] ${msg.text} [/INST]`;
        } else if (msg.role === 'model') {
            // Clean the tag for the prompt context
            const cleanText = msg.text.replace(/\[.*?\]\s*/, '').trim(); 
            prompt += ` ${cleanText} </s>`;
        }
    }
    // Note: We don't add the final [INST] for the new message here because 
    // the new message is already in the 'messages' array passed to this function.
    return prompt;
}

app.post("/api/chat", async (req, res) => {
  const { text, mode, sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ reply: "Error: Missing 'sessionId'." });
  }

  // Determine Persona
  const systemInstruction = PERSONAS[mode] || PERSONAS.casual;

  // Retrieve or Create Session
  let session = chatSessions.get(sessionId);

  // Reset session if it doesn't exist or if the Persona changed
  if (!session || session.systemInstruction !== systemInstruction) {
    console.log(`[Session] Starting new session: ${sessionId} (Mode: ${mode})`);
    session = {
      systemInstruction: systemInstruction,
      messages: [],
      geminiChat: null, // Holds the Gemini Chat Object
      modelName: null
    };
    chatSessions.set(sessionId, session);
  }

  // Push the NEW User Message to History
  session.messages.push({ role: "user", text: text });

  let replyText = null;
  let modelTag = "";

  // =========================================================
  // 1. TRY OLLAMA (Mistral)
  // =========================================================
  if (OLLAMA_API_ENDPOINT) {
    try {
      console.log(`[Ollama] Connecting to ${OLLAMA_URL}...`);
      const prompt = buildOllamaPrompt(session.systemInstruction, session.messages);

      const response = await fetch(OLLAMA_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: prompt,
          stream: false,
          num_predict: 300, // Increased to prevent cutoff
          options: { temperature: 0.7 }
        }),
      });

      if (response.ok) {
        const data = await response.json();
        replyText = data.response;
        modelTag = "[Ollama]";
        // If successful, we invalidate any existing Gemini chat to keep states sync
        session.geminiChat = null; 
      } else {
        console.warn(`[Ollama] Error Status: ${response.status}`);
      }
    } catch (e) {
      console.warn(`[Ollama] Failed: ${e.message}`);
    }
  }

  // =========================================================
  // 2. FALLBACK TO GEMINI (With History)
  // =========================================================
  if (!replyText && genAI) {
    console.log("[Gemini] Engaging fallback...");

    try {
      // Initialize Gemini Chat if not already active for this session
      if (!session.geminiChat) {
        let activeModel = null;
        
        // Try models in order until one works
        for (const modelName of GEMINI_FALLBACK_ORDER) {
          try {
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                systemInstruction: session.systemInstruction 
            });

            // Convert our session history to Gemini history format
            // EXCLUDING the very last message (which is the new one we want to send)
            const historyForGemini = session.messages.slice(0, -1).map(msg => ({
                role: msg.role === 'model' ? 'model' : 'user',
                parts: [{ text: msg.text.replace(/\[.*?\]\s*/, '').trim() }]
            }));

            // Start the chat
            const chat = model.startChat({
                history: historyForGemini,
            });
            
            session.geminiChat = chat;
            session.modelName = modelName;
            activeModel = modelName;
            break; // Stop loop if successful
          } catch (e) {
            console.warn(`[Gemini] ${modelName} init failed: ${e.message}`);
          }
        }
        if (!activeModel) throw new Error("All Gemini models failed.");
      }

      // Send the latest message
      const result = await session.geminiChat.sendMessage(text);
      replyText = result.response.text();
      modelTag = `[Gemini: ${session.modelName}]`;

    } catch (error) {
      console.error("[Gemini] Fatal Error:", error);
      // Clean up failed message from history so it doesn't break next turn
      session.messages.pop(); 
      session.geminiChat = null;
      return res.status(500).json({ reply: "Error: AI services unavailable." });
    }
  }

  // =========================================================
  // 3. FINALIZE
  // =========================================================
  if (replyText) {
    // Add Bot Reply to History
    session.messages.push({ role: "model", text: `${modelTag} ${replyText}` });
    chatSessions.set(sessionId, session);
    
    return res.json({ reply: `${modelTag} ${replyText}` });
  }

  // If we get here, everything failed
  session.messages.pop(); // Remove user message since we couldn't reply
  res.status(503).json({ reply: "Service Unavailable: Check logs." });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});