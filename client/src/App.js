import React, { useState, useEffect, useRef } from "react";
import "./App.css";

// ⚠️ IMPORTANT: CHANGE THIS TO YOUR RENDER URL FOR PRODUCTION
const API_BASE_URL = "https://avneeshbotproject.onrender.com/api"; 

// =================================================================
// 1. AUTH VIEW COMPONENT
// =================================================================
const AuthView = ({ onLoginSuccess, onGuestLogin }) => {
    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [message, setMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage('');
        setIsLoading(true);
        const endpoint = isRegistering ? 'register' : 'login';
        const payload = isRegistering ? { username, email, password } : { email, password };

        try {
            const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json();
            if (response.ok) {
                if (isRegistering) {
                    setMessage('Registration successful! Please log in.');
                    setIsRegistering(false);
                } else {
                    onLoginSuccess(data.token, data.username || "User");
                }
            } else {
                setMessage(data.message || 'Error occurred.');
            }
        } catch (error) {
            console.error(error);
            setMessage('Network error. Check backend connection.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <h2>{isRegistering ? 'Join the Squad' : 'Welcome Back'}</h2>
            <form onSubmit={handleSubmit}>
                {isRegistering && <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required />}
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
                <button type="submit" disabled={isLoading}>{isLoading ? 'Processing...' : isRegistering ? 'Register' : 'Login'}</button>
            </form>
            {message && <p className="auth-message">{message}</p>}
            <button className="toggle-btn" onClick={() => setIsRegistering(!isRegistering)}>
                {isRegistering ? 'Already have an account? Login' : "Don't have an account? Register"}
            </button>
            <div className="guest-divider"><span>OR</span></div>
            <button className="guest-btn" onClick={onGuestLogin}>😎 Continue as Guest</button>
        </div>
    );
};

// =================================================================
// 2. MAIN APP COMPONENT
// =================================================================
function App() {
    // --- STATE ---
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isGuest, setIsGuest] = useState(false);
    const [userName, setUserName] = useState("Guest");

    // 👇 Temporary ID for Guest Data Collection (Created once on load)
    const [tempGuestId] = useState("guest-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9));

    const [sessionsList, setSessionsList] = useState([]);
    const [activeSessionId, setActiveSessionId] = useState(null);
    const [chatHistory, setChatHistory] = useState([]);
    const [currentMode, setCurrentMode] = useState("casual");
    const [userInput, setUserInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const chatBoxRef = useRef(null);
    const MODE_LABELS = { casual: "😎 CASUAL", roast: "🔥 ROAST", flirt: "💖 FLIRT", depressed: "🌧️ SAD", angry: "😡 ANGRY", positive: "✨ HAPPY" };
    const initialGreeting = { role: "model", text: "Aur bhai? Avneesh here. Bol kya chal raha hai?" };

    // --- AUTH HANDLERS ---
    const handleLoginSuccess = (receivedToken, name) => {
        localStorage.setItem('token', receivedToken);
        setToken(receivedToken);
        setUserName(name || "User");
        setIsGuest(false);
        setIsLoggedIn(true);
    };

    const handleGuestLogin = () => {
        const name = prompt("Enter your name to start:") || "Guest";
        setUserName(name);
        setIsGuest(true);
        setIsLoggedIn(true);
        setChatHistory([initialGreeting]);
        setSessionsList([]);
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        setToken(null);
        setIsLoggedIn(false);
        setIsGuest(false);
        setChatHistory([]);
        setActiveSessionId(null);
    };

    // --- HELPERS ---
    const protectedFetch = (url, options = {}) => {
        const headers = { ...options.headers, 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return fetch(url, { ...options, headers });
    };

    // --- SESSION LOGIC (Registered Only) ---
    useEffect(() => {
        if (token && !isGuest) {
            setIsLoggedIn(true);
            fetchSessions();
        }
    }, [token, isGuest]);

    const fetchSessions = async () => {
        try {
            const res = await protectedFetch(`${API_BASE_URL}/sessions`);
            if (res.ok) {
                const sessions = await res.json();
                setSessionsList(sessions);
                if (sessions.length > 0) loadSessionHistory(sessions[0].session_id);
                else startNewChat();
            }
        } catch (e) { console.error(e); }
    };

    const startNewChat = async () => {
        if (isGuest) {
            setChatHistory([initialGreeting]);
            return;
        }
        const res = await protectedFetch(`${API_BASE_URL}/sessions`, { method: 'POST', body: JSON.stringify({ session_name: 'New Chat' }) });
        if (res.ok) {
            const data = await res.json();
            setSessionsList(prev => [data.session, ...prev]);
            setActiveSessionId(data.session.session_id);
            setChatHistory([initialGreeting]);
        }
    };

    const loadSessionHistory = async (sessionId) => {
        if (isGuest) return;
        setActiveSessionId(sessionId);
        setIsLoading(true);
        const res = await protectedFetch(`${API_BASE_URL}/chat/${sessionId}`);
        if (res.ok) {
            const hist = await res.json();
            setChatHistory(hist.length ? hist.map(m => ({ role: m.role, text: m.content })) : [initialGreeting]);
        }
        setIsLoading(false);
    };

    // --- SEND MESSAGE LOGIC ---
    const generateAIResponse = async () => {
        if (!userInput.trim() || isLoading) return;
        if (!isGuest && !activeSessionId) return;

        const userText = userInput.trim();
        setIsLoading(true);
        setUserInput(""); 
        const loaderId = Date.now();
        setChatHistory(prev => [...prev, { role: "user", text: userText }, { role: "model", text: "", id: loaderId }]);

        try {
            // Determine Payload
            const payload = {
                prompt: userText,
                mode: currentMode,
                // If Guest: Send History + Temp ID. If User: Send Real Session ID.
                ...(isGuest 
                    ? { history: chatHistory, session_id: tempGuestId } 
                    : { session_id: activeSessionId }
                )
            };

            const response = await protectedFetch(`${API_BASE_URL}/chat`, {
                method: "POST",
                body: JSON.stringify(payload),
            });
            const data = await response.json();
            
            setChatHistory(prev => prev.map(msg => msg.id === loaderId ? { role: "model", text: data.response } : msg));

            // Refresh session name if it was "New Chat" (Registered Users)
            if (!isGuest && sessionsList.find(s => s.session_id === activeSessionId)?.session_name === 'New Chat') {
                fetchSessions();
            }
        } catch (error) {
            setChatHistory(prev => prev.map(msg => msg.id === loaderId ? { role: "model", text: "Error connecting to bot." } : msg));
        } finally {
            setIsLoading(false);
        }
    };

    // --- AUTO SCROLL ---
    useEffect(() => {
        if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }, [chatHistory]);

    return (
        <div className={`app-wrapper ${!isLoggedIn ? 'auth-view' : 'chat-view'}`}>
            {!isLoggedIn ? (
                <AuthView onLoginSuccess={handleLoginSuccess} onGuestLogin={handleGuestLogin} />
            ) : (
                <div className="chat-interface-container">
                    <div className="sidebar">
                        <h3 className="sidebar-title">Avneesh Bot</h3>
                        <p style={{fontSize: '0.8rem', color: '#aaa', paddingLeft:'15px'}}>Logged in as: {userName}</p>
                        <button className="new-chat-btn" onClick={startNewChat}>+ New Chat</button>
                        <hr className="sidebar-divider"/>
                        
                        {isGuest ? (
                            <div style={{padding: '15px', color: '#888', fontStyle: 'italic', fontSize: '0.9rem'}}>
                                Guest Mode Active.<br/>Chats are saved anonymously for training.
                            </div>
                        ) : (
                            <div className="session-list">
                                {sessionsList.map(s => (
                                    <div key={s.session_id} className={`session-item ${s.session_id === activeSessionId ? 'active' : ''}`} onClick={() => loadSessionHistory(s.session_id)}>
                                        {s.session_name || "Untitled"}
                                    </div>
                                ))}
                            </div>
                        )}
                        <button className="logout-btn" onClick={handleLogout}>{isGuest ? "Exit Guest Mode" : "Logout"}</button>
                    </div>

                    <div className={`container mode-${currentMode}`}>
                        <div className="header">
                            <h2>{isGuest ? "Guest Session" : sessionsList.find(s => s.session_id === activeSessionId)?.session_name || "Chat"}</h2>
                            <span className="mode-badge">{MODE_LABELS[currentMode]}</span>
                            <select value={currentMode} onChange={(e) => setCurrentMode(e.target.value)}>
                                <option value="casual">😎 Casual</option>
                                <option value="roast">🔥 Roast</option>
                                <option value="flirt">💖 Flirt</option>
                                <option value="depressed">🌧️ Sad</option>
                                <option value="angry">😡 Angry</option>
                                <option value="positive">✨ Happy</option>
                            </select>
                        </div>

                        <div id="chat-box" ref={chatBoxRef}>
                            {chatHistory.map((msg, i) => (
                                <div key={msg.id || i} className={`message ${msg.role === "user" ? "user" : "bot"} ${msg.text==="" ? "loading" : ""}`}>
                                    {msg.text}
                                </div>
                            ))}
                        </div>
                        
                        <div id="input-area">
                            <input type="text" value={userInput} onChange={(e) => setUserInput(e.target.value)} onKeyPress={(e) => e.key === "Enter" && generateAIResponse()} placeholder="Type here..." disabled={isLoading} />
                            <button onClick={generateAIResponse} disabled={isLoading}>Send</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;