import React, { useState, useEffect, useRef } from "react";
import "./App.css";

function App() {
  // --- STATE MANAGEMENT ---
  const [currentMode, setCurrentMode] = useState("casual");

  // Initialize chatHistory with the initial greeting (only runs once on mount)
  const initialGreeting = {
    role: "model",
    text: "Aur bhai? Avneesh here. Bol kya chal raha hai? (Tell me, what's up?)",
  };
  const [chatHistory, setChatHistory] = useState([initialGreeting]);

  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // 👇 NEW: User Identification State
  const [userName, setUserName] = useState(null);
  const [permanentUserId, setPermanentUserId] = useState(null);

  const [sessionId] = useState(
    "sess-" + Date.now().toString(36) + Math.random().toString(36).substring(2)
  );
  const userAgent = navigator.userAgent;

  const chatBoxRef = useRef(null);
  const hasPrompted = useRef(false); // To prevent double prompt

  const MODE_LABELS = {
    casual: "😎 CASUAL MODE",
    roast: "🔥 ROAST MODE",
    flirt: "💖 FLIRT MODE",
    depressed: "🌧️ BURNOUT MODE",
    angry: "😡 RAGE MODE",
    positive: "✨ MOTIVATED MODE",
  };

  // --- EFFECT 1: Handle Initial Name Prompt (using ref) and Scroll ---
  useEffect(() => {
    // 1. Initial Prompt for Name - Only run if the ref hasn't marked it as run.
    if (!hasPrompted.current) {
      const name = prompt("Hello! Please enter your name to start chatting:");
      if (name && name.trim().length > 0) {
        setUserName(name.trim());
      } else {
        setUserName("Guest");
      }
      hasPrompted.current = true; // Mark as run
    }

    // 2. Scroll to bottom whenever history or UI changes
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [chatHistory, userName]);

  // --- HANDLERS ---
  const handleModeChange = (e) => {
    const newMode = e.target.value;
    setCurrentMode(newMode);
    // Add system message to history
    setChatHistory((prev) => [
      ...prev,
      { role: "system", text: `System: Switched to ${MODE_LABELS[newMode]}.` },
    ]);
  };

  const generateAIResponse = async () => {
    if (!userInput.trim() || isLoading) return;

    const userText = userInput.trim();
    setIsLoading(true);
    setUserInput(""); // Clear input

    // 1. Prepare optimistic update for UI (RUNS ONCE, THEN TWICE IN STRICT MODE)
    // We only use the user's message and a temporary loading ID (loaderId)
    const loaderId = Date.now();
    const newUserMessage = { role: "user", text: userText };
    // New (The CSS animation will fill the bubble with the moving dots)
    const loadingMessage = { role: "model", text: "", id: loaderId };

    setChatHistory((prev) => [...prev, newUserMessage, loadingMessage]);

    try {
      // NOTE: We pass the history from the state AT THE TIME the function runs.
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: userText,
          mode: currentMode,
          history: chatHistory,

          // 👇 USER DATA SENT TO BACKEND 👇
          sessionId: sessionId,
          user_name: userName,
          user_agent: userAgent,
          user_id: permanentUserId,
        }),
      });

      const data = await response.json();
      const botReply = data.reply;

      // 2. FINAL UPDATE: Replace the loading message with the real response
      // This uses a functional update to ensure it operates on the latest state
      setChatHistory((prev) => {
        // Find the loading message by the temporary ID and replace it
        return prev.map((msg) =>
          msg.id === loaderId
            ? { role: "model", text: botReply } // Replace with final reply
            : msg
        );
      });
    } catch (error) {
      console.error(error);
      const errorMsg =
        "[Error] Could not connect to the backend or AI service.";

      // 3. Update history with error message (Replace the loading placeholder)
      setChatHistory((prev) => {
        return prev.map((msg) =>
          msg.id === loaderId ? { role: "model", text: errorMsg } : msg
        );
      });
    } finally {
      setIsLoading(false);
    }
  };

  // --- JSX RENDER ---
  return (
    <div className={`container mode-${currentMode}`}>
      <div className="header">
        <h2>Avneesh Bot v3.0 (React/Postgres)</h2>
        <p style={{ margin: "5px 0 0", fontSize: "0.9rem", color: "#aaa" }}>
          Chatting as: **{userName}**
        </p>
        {/* Sign Up Placeholder - FUTURE FEATURE */}
        {userName !== "Guest" && !permanentUserId && (
          <button
            onClick={() => alert("Sign Up logic to be implemented here!")}
            style={{
              marginTop: "10px",
              padding: "5px 10px",
              background: "#4CAF50",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
            }}
          >
            [WIP] Sign Up to Save Chats
          </button>
        )}
        <span id="current-mode-display" className="mode-badge">
          {MODE_LABELS[currentMode]}
        </span>
        <select
          id="mode-selector"
          value={currentMode}
          onChange={handleModeChange}
        >
          <option value="casual">😎 Casual Avneesh (Default)</option>
          <option value="roast">🔥 Roast Mode</option>
          <option value="flirt">💖 Flirt Mode</option>
          <option value="depressed">🌧️ Burnout Mode</option>
          <option value="angry">😡 Rage Mode</option>
          <option value="positive">✨ Motivated Mode</option>
        </select>
      </div>
      <div id="chat-box" ref={chatBoxRef}>
        {chatHistory.map((msg, index) => {
          // Determine if this is the active loading message (empty text and has a temporary ID)
          const isProcessing = msg.text === "" && msg.id;

          return (
            <div
              key={msg.id || index}
              className={`message ${msg.role === "user" ? "user" : "bot"} ${
                isProcessing ? "loading" : ""
              }`}
            >
              {/* Only render text if it's NOT the processing message. */}
              {isProcessing ? null : msg.text}
            </div>
          );
        })}
      </div>
      <div id="input-area">
        <input
          type="text"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && generateAIResponse()}
          placeholder={`Ask ${userName || "Avneesh"} something...`}
          disabled={isLoading || !userName}
        />
        <button onClick={generateAIResponse} disabled={isLoading || !userName}>
          Send
        </button>
      </div>
    </div>
  );
}

export default App;
