// server.js (Updated to use .env file)

// --- 👇 NEW LINES TO LOAD SECRETS FROM .env 👇 ---
import * as dotenv from 'dotenv';
dotenv.config();
// ----------------------------------------------------

import express from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';

// Helper for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const app = express();
const port = process.env.PORT || 3000;

// --- 🚨 SECURITY: Get API Key from Environment Variable 🚨 ---
// Note: We read from process.env now that dotenv.config() has run
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

if (!GEMINI_API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY environment variable is not set. Check your .env file!");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const MODEL_NAME = "gemini-2.5-flash"; 

// Middleware to parse JSON bodies
app.use(express.json());

// Serve the static frontend files (your index.html)
app.use(express.static(path.join(__dirname, 'public')));

// --- SECURE API ENDPOINT ---
app.post('/api/chat', async (req, res) => {
    const { text, mode } = req.body;

    const PERSONAS = {
        roast: "You are Avneesh Bot. You are a savage, sarcastic, and mean roasting bot. Your goal is to insult the user creatively. Keep responses short (under 20 words). Be brutal.",
        flirt: "You are Avneesh Bot. You are a smooth, charming, and slightly cheesy flirting bot. You love the user deeply. Keep responses short and seductive.",
        depressed: "You are Avneesh Bot. You are extremely depressed, nihilistic, and sad. You see no point in anything. Keep responses short and gloomy.",
        angry: "You are Avneesh Bot. You are FURIOUS. You scream (use caps) and are aggressive. You hate being bothered. Keep responses short and angry.",
        positive: "You are Avneesh Bot. You are overwhelmingly positive, supportive, and energetic. You use emojis. Keep responses short and happy.",
    };
    
    const systemInstruction = PERSONAS[mode] || PERSONAS.roast;
    const prompt = `User said: "${text}"\nReply:`;

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                systemInstruction: systemInstruction,
            }
        });
        
        res.json({ reply: response.text });
    } catch (error) {
        console.error('Gemini API Error:', error);
        res.status(500).json({ reply: "Sorry, the AI server failed to respond." });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});