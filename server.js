// server.js (FINAL VERSION: OLLAMA PRIMARY / GEMINI FALLBACK)

import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
// Import GoogleGenAI only once at the top for potential use in the fallback
import { GoogleGenAI } from '@google/genai';

// Helper for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// ----------------------------------------------------------------------
// 👇 CONFIGURE API SETTINGS 👇
// OLLAMA_URL is the ngrok URL (e.g., https://unimposing-noble-subtly.ngrok-free.dev)
const OLLAMA_URL = process.env.OLLAMA_URL; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Your original key for fallback
const OLLAMA_MODEL = "mistral"; // The model you are running locally via Ollama

// Ollama API endpoint for generation is always /api/generate
const OLLAMA_API_ENDPOINT = OLLAMA_URL ? `${OLLAMA_URL}/api/generate` : null; 

// Gemini Fallback Models
const GEMINI_FALLBACK_ORDER = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"];
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
// ----------------------------------------------------------------------

// Middleware to parse JSON bodies and serve static files
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- DEFINING PERSONAS ---
const PERSONAS = {
    roast: "You are Avneesh Bot. You are a savage, sarcastic, and mean roasting bot. Your goal is to insult the user creatively. Keep responses short (under 20 words). Be brutal.",
    flirt: "You are Avneesh Bot. You are a smooth, charming, and slightly cheesy flirting bot. You love the user deeply. Keep responses short and seductive.",
    depressed: "You are Avneesh Bot. You are extremely depressed, nihilistic, and sad. You see no point in anything. Keep responses short and gloomy.",
    angry: "You are Avneesh Bot. You are FURIOUS. You scream (use caps) and are aggressive. You hate being bothered. Keep responses short and angry.",
    positive: "You are Avneesh Bot. You are overwhelmingly positive, supportive, and energetic. You use emojis. Keep responses short and happy.",
};

// --- SECURE API ENDPOINT with Fallback Logic ---
app.post('/api/chat', async (req, res) => {
    const { text, mode } = req.body;
    const systemInstruction = PERSONAS[mode] || PERSONAS.roast;
    
    // 1. **PRIORITY: OLLAMA (Mistral) LOCAL MODEL VIA NGROK**
    if (OLLAMA_API_ENDPOINT) {
        try {
            console.log(`Using OLLAMA at ${OLLAMA_URL}`);

            const response = await fetch(OLLAMA_API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: OLLAMA_MODEL,
                    prompt: `${systemInstruction}\nUser said: "${text}"\nReply:`,
                    stream: false // Return the full response at once
                })
            });

            // Check if the HTTP status is OK (200-299 range)
            if (!response.ok) {
                 throw new Error(`Ollama API failed with status: ${response.status}`);
            }

            const data = await response.json();
            
            // The model's response is in the 'response' field of the JSON body
            return res.json({ 
                reply: `[Ollama: Mistral] ${data.response}` 
            });

        } catch (error) {
            console.warn(`Ollama/ngrok failed. Falling back to Gemini. Error: ${error.message}`);
            // If the local service fails (e.g., laptop closed, ngrok error), we fall through.
        }
    }

    // 2. **FALLBACK: GEMINI API**
    if (ai) {
        try {
            console.log("Falling back to Gemini API.");
            for (const modelName of GEMINI_FALLBACK_ORDER) {
                try {
                    const response = await ai.models.generateContent({
                        model: modelName,
                        contents: [{ role: "user", parts: [{ text: `${systemInstruction}\nUser said: "${text}"` }] }],
                        // Note: Gemini uses systemInstruction in the config, Ollama uses it in the prompt.
                        config: { systemInstruction: systemInstruction } 
                    });
                    
                    return res.json({ reply: `[Gemini Fallback: ${modelName}] ${response.text}` });
                } catch (e) {
                    console.warn(`Gemini model ${modelName} failed. Trying next model.`);
                }
            }
        } catch (error) {
             console.error("Fatal Error: Both Ollama and Gemini failed.", error);
        }
    }
    
    // If all services fail
    res.status(503).json({ 
        reply: `AI service unavailable. Check OLLAMA_URL/ngrok and GEMINI_API_KEY.`
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});