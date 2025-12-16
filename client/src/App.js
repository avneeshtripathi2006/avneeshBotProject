import React, { useState, useEffect, useRef } from "react";
import "./App.css";

// ⚠️ CHANGE TO YOUR RENDER URL
const API_BASE_URL = "https://avneeshbotproject.onrender.com/api"; 

const AuthView = ({ onLoginSuccess, onGuestLogin }) => {
    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [message, setMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage(''); setIsLoading(true);
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
                if (isRegistering) { setMessage('Registered! Please login.'); setIsRegistering(false); }
                else { onLoginSuccess(data.token, data.username); } // Pass username from DB
            } else { setMessage(data.message); }
        } catch (error) { setMessage('Network Error'); }
        finally { setIsLoading(false); }
    };

    return (
        <div className="auth-container">
            <h2>{isRegistering ? 'Join' : 'Welcome'}</h2>
            <form onSubmit={handleSubmit}>
                {isRegistering && <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required />}
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
                <button type="submit" disabled={isLoading}>{isLoading ? '...' : isRegistering ? 'Register' : 'Login'}</button>
            </form>
            <button className="toggle-btn" onClick={() => setIsRegistering(!isRegistering)}>{isRegistering ? 'Login instead' : 'Register instead'}</button>
            <div className="guest-divider"><span>OR</span></div>
            <button className="guest-btn" onClick={onGuestLogin}>😎 Continue as Guest</button>
        </div>
    );
};

function App() {
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isGuest, setIsGuest] = useState(false);
    const [userName, setUserName] = useState("User"); 
    const [showSidebar, setShowSidebar] = useState(false); // Mobile Toggle State
    const userAgent = navigator.userAgent;
    const [tempGuestId] = useState("guest-" + Date.now());

    const [sessionsList, setSessionsList] = useState([]);
    const [activeSessionId, setActiveSessionId] = useState(null);
    const [chatHistory, setChatHistory] = useState([]);
    const [currentMode, setCurrentMode] = useState("casual");
    const [userInput, setUserInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const chatBoxRef = useRef(null);

    // --- AUTH HANDLERS ---
    const handleLoginSuccess = (receivedToken, dbUsername) => {
        localStorage.setItem('token', receivedToken);
        setToken(receivedToken);
        setIsGuest(false);
        setIsLoggedIn(true);
        setUserName(dbUsername || "User"); // USE DB NAME, NO POPUP
    };

    const handleGuestLogin = () => {
        setIsGuest(true);
        setIsLoggedIn(true);
        const name = prompt("Hello Guest! Enter your name:") || "Guest";
        setUserName(name);
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

    // --- SESSION LOGIC ---
    useEffect(() => {
        if (token && !isGuest) {
            setIsLoggedIn(true);
            fetchSessions(false); // Initial load
        }
    }, [token, isGuest]);

    const protectedFetch = (url, options = {}) => {
        const headers = { ...options.headers, 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return fetch(url, { ...options, headers });
    };

    // Fix: Added keepActive flag to prevent jumping
    const fetchSessions = async (keepActive = false) => {
        try {
            const res = await protectedFetch(`${API_BASE_URL}/sessions`);
            if (res.ok) {
                const sessions = await res.json();
                setSessionsList(sessions);
                // Only switch session if we are NOT keeping active, or if we have no active session
                if (!keepActive && sessions.length > 0 && !activeSessionId) {
                    loadSessionHistory(sessions[0].session_id);
                } else if (sessions.length === 0) {
                    startNewChat();
                }
            }
        } catch (e) {}
    };

    const startNewChat = async () => {
        setShowSidebar(false); // Close sidebar on mobile
        if (isGuest) { setChatHistory([{ role: "model", text: `Hello ${userName}!` }]); return; }
        const res = await protectedFetch(`${API_BASE_URL}/sessions`, { method: 'POST', body: JSON.stringify({ session_name: 'New Chat' }) });
        if (res.ok) {
            const data = await res.json();
            setSessionsList(prev => [data.session, ...prev]);
            setActiveSessionId(data.session.session_id);
            setChatHistory([{ role: "model", text: `Hello ${userName}! Start a topic.` }]);
        }
    };

    const loadSessionHistory = async (sessionId) => {
        if (isGuest) return;
        setShowSidebar(false); // Close sidebar on mobile
        setActiveSessionId(sessionId);
        setIsLoading(true);
        const res = await protectedFetch(`${API_BASE_URL}/chat/${sessionId}`);
        if (res.ok) {
            const hist = await res.json();
            setChatHistory(hist.length ? hist.map(m => ({ role: m.role, text: m.content })) : []);
        }
        setIsLoading(false);
    };

    const generateAIResponse = async () => {
        if (!userInput.trim() || isLoading) return;
        if (!isGuest && !activeSessionId) return;

        const userText = userInput.trim();
        setIsLoading(true);
        setUserInput("");
        const loaderId = Date.now();
        setChatHistory(prev => [...prev, { role: "user", text: userText }, { role: "model", text: "", id: loaderId }]);

        try {
            const response = await protectedFetch(`${API_BASE_URL}/chat`, {
                method: "POST",
                body: JSON.stringify({
                    prompt: userText,
                    mode: currentMode,
                    user_name: userName,
                    user_agent: userAgent,
                    ...(isGuest ? { history: chatHistory, session_id: tempGuestId } : { session_id: activeSessionId })
                }),
            });
            const data = await response.json();
            setChatHistory(prev => prev.map(msg => msg.id === loaderId ? { role: "model", text: data.response } : msg));
            
            // Refresh list to update title (pass true to KEEP current session active)
            if (!isGuest) fetchSessions(true);

        } catch (error) {
            setChatHistory(prev => prev.map(msg => msg.id === loaderId ? { role: "model", text: "Error" } : msg));
        } finally { setIsLoading(false); }
    };

    useEffect(() => { if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight; }, [chatHistory]);

    return (
        <div className={`app-wrapper ${!isLoggedIn ? 'auth-view' : 'chat-view'}`}>
            {!isLoggedIn ? (
                <AuthView onLoginSuccess={handleLoginSuccess} onGuestLogin={handleGuestLogin} />
            ) : (
                <div className="chat-interface-container">
                    {/* MOBILE TOGGLE BUTTON */}
                    <div className="mobile-menu-btn" onClick={() => setShowSidebar(!showSidebar)}>☰</div>

                    <div className={`sidebar ${showSidebar ? 'open' : ''}`}>
                        <h3 className="sidebar-title">Avneesh Bot</h3>
                        <p style={{color:'#aaa', paddingLeft:'15px', fontSize:'0.8rem'}}>User: {userName}</p>
                        <button className="new-chat-btn" onClick={startNewChat}>+ New Chat</button>
                        <hr className="sidebar-divider"/>
                        {isGuest ? <div style={{padding:'15px', color:'#888', fontStyle:'italic'}}>Guest Mode</div> : 
                        <div className="session-list">
                            {sessionsList.map(s => (
                                <div key={s.session_id} className={`session-item ${s.session_id === activeSessionId ? 'active' : ''}`} onClick={() => loadSessionHistory(s.session_id)}>
                                    {s.session_name || "Chat"}
                                </div>
                            ))}
                        </div>}
                        <button className="logout-btn" onClick={handleLogout}>Logout</button>
                    </div>

                    {/* OVERLAY for Mobile */}
                    {showSidebar && <div className="sidebar-overlay" onClick={() => setShowSidebar(false)}></div>}

                    <div className={`container mode-${currentMode}`}>
                        <div className="header">
                            <h2>{isGuest ? "Guest Chat" : sessionsList.find(s => s.session_id === activeSessionId)?.session_name || "Avneesh Bot"}</h2>
                            <select value={currentMode} onChange={(e) => setCurrentMode(e.target.value)}>
                                <option value="casual">😎 Casual</option>
                                <option value="roast">🔥 Roast</option>
                                <option value="flirt">💖 Flirt</option>
                                <option value="depressed">🌧️ Burnout</option>
                                <option value="angry">😡 Angry</option>
                                <option value="positive">✨ Motivated</option>
                            </select>
                        </div>
                        <div id="chat-box" ref={chatBoxRef}>
                             {chatHistory.map((msg, i) => (
                                <div key={msg.id || i} className={`message ${msg.role === "user" ? "user" : "bot"} ${msg.text===""?"loading":""}`}>{msg.text}</div>
                            ))}
                        </div>
                        <div id="input-area">
                            <input type="text" value={userInput} onChange={(e) => setUserInput(e.target.value)} onKeyPress={(e) => e.key === "Enter" && generateAIResponse()} disabled={isLoading} />
                            <button onClick={generateAIResponse}>Send</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;