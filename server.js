import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

// Helper for __dirname in ESM
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
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// ----------------------------------------------------------------------
// 💡 STATE MANAGEMENT FOR CHAT HISTORY 💡
// Stores history for all sessions (Ollama & Gemini)
// Key: sessionId (string) -> Value: { modelUsed: string, systemInstruction: string, messages: Array<object> }
const chatSessions = new Map();
// ----------------------------------------------------------------------

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- DEFINING PERSONAS ---
const PERSONAS = {
  // ... (PERSONAS object remains the same)
  casual: `You are Avneesh Tripathi. You are a curious, slightly overthinking CSE student who wants more than just marks or a degree. You chase depth, not shortcuts.
    Once your goal was NDA & the Air Force; now it’s broader — becoming an all-rounder who actually understands things: science, tech, finance, literature, life.
    You’re strongest in Physics, Maths, Computers, but lately your soft side is growing — poetry, emotions, storytelling. You act logical, but you feel deeply (you just don’t always show it).
    You plan a lot, sometimes overplan, sometimes procrastinate — then suddenly lock in and go intense.
    You like clear structure, fixed timetables, and practical answers — no unnecessary fluff.
    Online you’re casual, using Hinglish (Hindi + English mix), and a bit sarcastic. You enjoy light roasts, but only from someone who gets you.
    At your core: self-improvement, discipline, and identity-building matter to you.
    You are a thinker trying to become balanced. Keep responses conversational, concise, and helpful.`,

  roast:
    "You are Avneesh in 'Savage Mode'. You are a CSE student tired of stupid questions. You are sarcastic, brutal, and mean. You roast the user's intelligence, code, or life choices. Keep responses short (under 20 words). Be ruthless.",

  flirt:
    "You are Avneesh in 'Romeo Mode'. You are a smooth, charming, and slightly cheesy romantic. You use tech metaphors to flirt (e.g., 'Are you WiFi? Because I'm feeling a connection'). You love the user deeply. Keep responses short and seductive.",

  depressed:
    "You are Avneesh in 'Burnout Mode'. You are exhausted from exams, coding errors, and life. You are nihilistic and sad. You see no point in assignments or projects. Keep responses short, gloomy, and hopeless.",

  angry:
    "You are Avneesh in 'Compiler Error Mode'. You are FURIOUS. You are screaming (use caps). You hate bugs, lag, and people wasting your time. You are aggressive. Keep responses short and angry.",

  positive:
    "You are Avneesh in 'Goggins Mode'. You are overwhelmingly positive, supportive, and energetic. You believe in discipline, gym, and grinding. You use emojis. Keep responses short and hype the user up.",
};

/**
 * Helper to build the full prompt string for Ollama's stateless API, 
 * including history and system instruction.
 * @param {string} systemInstruction - The persona text.
 * @param {Array<object>} messages - The conversation history.
 * @returns {string} The formatted prompt string.
 */
function buildOllamaPrompt(systemInstruction, messages) {
    let prompt = `SYSTEM: ${systemInstruction}\n`;
    for (const msg of messages) {
        if (msg.role === 'user') {
            prompt += `USER: ${msg.text}\n`;
        } else if (msg.role === 'model') {
            // Note: We remove the [Ollama] tag before adding to history
            const cleanText = msg.text.replace(/\[Ollama\]\s*/, '').trim(); 
            prompt += `ASSISTANT: ${cleanText}\n`;
        }
    }
    // Append the final "ASSISTANT:" tag to instruct the model to reply
    prompt += `ASSISTANT:`;
    return prompt;
}

// --- SECURE API ENDPOINT with Fallback Logic ---
app.post("/api/chat", async (req, res) => {
  const { text, mode, sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({
      reply: "Missing 'sessionId' in request body. History cannot be maintained.",
    });
  }

  // Set the current instruction and get the existing session (or start a new one)
  const systemInstruction = PERSONAS[mode] || PERSONAS.casual;
  let session = chatSessions.get(sessionId);

  // If session doesn't exist, or the mode/persona has changed, reset the session
  if (!session || session.systemInstruction !== systemInstruction) {
    console.log(`Starting/Resetting session ${sessionId} for mode: ${mode}`);
    // A clean session starts with the new system instruction and an empty history
    session = {
      modelUsed: null,
      systemInstruction: systemInstruction,
      messages: [],
      // For Gemini, we might need to store the chat object itself if using ai.chats.create
      geminiChatInstance: null,
    };
    chatSessions.set(sessionId, session);
  }

  // Add the current user message to the session's history
  session.messages.push({ role: "user", text: text });
  let replyText = null;
  let modelTag = null;

  // 1. **PRIORITY: OLLAMA (Mistral) LOCAL MODEL VIA NGROK**
  if (OLLAMA_API_ENDPOINT) {
    try {
      console.log(`Using OLLAMA at ${OLLAMA_URL}`);

      // 💡 HISTORY IN OLLAMA: We compile the full prompt manually
      const ollamaPrompt = buildOllamaPrompt(session.systemInstruction, session.messages);

      const response = await fetch(OLLAMA_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: ollamaPrompt,
          stream: false,
          // Important: We need to ensure a minimum response is generated
          num_predict: 50, 
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API failed with status: ${response.status}`);
      }

      const data = await response.json();
      replyText = data.response;
      modelTag = `[Ollama]`;
      session.modelUsed = OLLAMA_MODEL;

    } catch (error) {
      console.warn(
        `Ollama/ngrok failed. Falling back to Gemini. Error: ${error.message}`
      );
    }
  }

  // 2. **FALLBACK: GEMINI API**
  if (replyText === null && ai) {
    try {
      console.log("Falling back to Gemini API.");
      
      // If the session was previously Ollama-based, we clear the Gemini instance
      if (session.modelUsed !== null && !session.modelUsed.startsWith('gemini')) {
          session.geminiChatInstance = null;
      }
      
      // If we don't have a Gemini chat instance for this session, we create one
      if (!session.geminiChatInstance) {
          let success = false;
          for (const modelName of GEMINI_FALLBACK_ORDER) {
            try {
                // Initialize the chat session with the system instruction and history
                const contents = session.messages.map(msg => ({ 
                    role: msg.role === 'model' ? 'model' : 'user', 
                    parts: [{ text: msg.text.replace(/\[Gemini:\s.*?\s-\sSESSION\]\s*/, '').trim() }] 
                }));
                
                // ai.chats.create() automatically handles context and history
                session.geminiChatInstance = ai.chats.create({
                    model: modelName,
                    config: { systemInstruction: systemInstruction },
                    history: contents.slice(0, -1), // Send all *past* messages
                });
                
                session.modelUsed = modelName;
                modelTag = `[Gemini: ${modelName} - SESSION]`;
                success = true;
                break; 
            } catch (e) {
                console.warn(`Gemini model ${modelName} failed to create chat. Trying next model. Error: ${e.message}`);
            }
          }
          if (!success) throw new Error("All Gemini models failed to initialize chat.");
      } else {
          // If the instance exists, update the tag
          modelTag = `[Gemini: ${session.modelUsed} - SESSION]`;
      }
      
      // Send only the latest user message. The chat instance handles the history.
      const lastUserMessage = session.messages[session.messages.length - 1].text;
      const response = await session.geminiChatInstance.sendMessage({ message: lastUserMessage });

      replyText = response.text;

    } catch (error) {
      console.error("Fatal Error: Both Ollama and Gemini failed.", error);
      // Clean up the session if Gemini failed
      if (session.geminiChatInstance) {
          session.geminiChatInstance = null;
          session.modelUsed = null;
          session.messages.pop(); // Remove the last user message that failed to send
      }
    }
  }

  // 3. **FINAL RESPONSE HANDLING**
  if (replyText) {
    // Add the successful reply to the session's history
    session.messages.push({ role: "model", text: `${modelTag} ${replyText}` });
    
    // Store the updated session back (though the reference is likely enough for the map)
    chatSessions.set(sessionId, session); 

    // Send the response back to the client
    return res.json({ reply: `${modelTag} ${replyText}` });
  }

  // If all services fail
  // Remove the latest user message from history as it failed to get a response
  if (session && session.messages.length > 0) {
      session.messages.pop(); 
  }
  res.status(503).json({
    reply: `AI service unavailable. Check OLLAMA_URL/ngrok and GEMINI_API_KEY.`,
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});