import React, { useState, useEffect, useRef, useCallback } from "react";
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
                else { onLoginSuccess(data.token, data.username); }
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
    // --- 1. STATE INITIALIZATION (Read from Storage) ---
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [userName, setUserName] = useState(localStorage.getItem('userName') || "User");
    
    // FIX: Read the last active session from storage so we don't lose it on refresh
    const [activeSessionId, setActiveSessionId] = useState(() => {
        const saved = localStorage.getItem('lastSessionId');
        return saved ? Number(saved) : null;
    });

    const [isLoggedIn, setIsLoggedIn] = useState(!!token);
    const [isGuest, setIsGuest] = useState(false);
    
    // UI State
    const [showSidebar, setShowSidebar] = useState(false);
    const [sessionsList, setSessionsList] = useState([]);
    const [chatHistory, setChatHistory] = useState([]);
    const [currentMode, setCurrentMode] = useState("casual");
    const [userInput, setUserInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    
    const userAgent = navigator.userAgent;
    const [tempGuestId] = useState("guest-" + Date.now());
    const chatBoxRef = useRef(null);

    // --- 2. PERSISTENCE EFFECTS ---
    // Whenever activeSessionId changes, save it to localStorage
    useEffect(() => {
        if (activeSessionId) {
            localStorage.setItem('lastSessionId', activeSessionId);
        }
    }, [activeSessionId]);

    // --- 3. CORE HANDLERS ---
    const handleLogout = useCallback(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('userName');
        localStorage.removeItem('lastSessionId'); // Clear session memory
        setToken(null);
        setUserName("User");
        setIsLoggedIn(false);
        setIsGuest(false);
        setChatHistory([]);
        setActiveSessionId(null);
    }, []);

    // FIX: Auto-Logout if token is invalid (401)
    const protectedFetch = useCallback(async (url, options = {}) => {
        const headers = { ...options.headers, 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        
        const response = await fetch(url, { ...options, headers });
        
        if (response.status === 401) {
            handleLogout(); // Auto logout if session expired
            return response;
        }
        return response;
    }, [token, handleLogout]);

    // --- 4. DATA LOADING ---
    
    // Load Specific Chat History
    const loadSessionHistory = useCallback(async (sessionId, isInitialization = false) => {
        if (isGuest && !sessionId) return;
        
        setShowSidebar(false);
        setActiveSessionId(sessionId); // This triggers the storage save
        setIsLoading(true);
        
        if (!isInitialization) setChatHistory([]); 
        
        try {
            const res = await protectedFetch(`${API_BASE_URL}/chat/${sessionId}`);
            if (res.ok) {
                const hist = await res.json();
                const historyLoaded = hist.length ? hist.map(m => ({ role: m.role, text: m.content })) : [];
                
                if (historyLoaded.length === 0) {
                     historyLoaded.push({ role: "model", text: `Hello ${userName}! Start a topic.` });
                }
                setChatHistory(historyLoaded);
            }
        } catch (e) { console.error("History load failed", e); }
        finally { setIsLoading(false); }
    }, [isGuest, userName, protectedFetch]);

    // Fetch Session List & Decide what to open
    const fetchSessions = useCallback(async (shouldLoadHistory = false) => {
        try {
            const res = await protectedFetch(`${API_BASE_URL}/sessions`);
            if (res.ok) {
                const sessions = await res.json();
                setSessionsList(sessions);
                
                if (shouldLoadHistory) {
                    let sessionToLoad = null;
                    
                    // Priority 1: Use the restored ID from localStorage (activeSessionId)
                    // But verify it exists in the fetched list to avoid stale IDs
                    if (activeSessionId && sessions.some(s => s.session_id === activeSessionId)) {
                        sessionToLoad = activeSessionId;
                    } 
                    // Priority 2: Use the most recent session
                    else if (sessions.length > 0) {
                        sessionToLoad = sessions[0].session_id;
                    }

                    if (sessionToLoad) {
                        loadSessionHistory(sessionToLoad, true);
                    } else if (sessions.length === 0) {
                        // Correctly handle empty state
                        setChatHistory([]);
                    }
                }
            }
        } catch (e) { console.error("Fetch sessions failed", e); }
    }, [protectedFetch, activeSessionId, loadSessionHistory]);

    // Initialization Effect
    useEffect(() => {
        if (token && !isGuest) {
            setIsLoggedIn(true);
            fetchSessions(true); 
        }
    }, [token, isGuest, fetchSessions]); 

    // --- 5. USER ACTIONS ---
    const handleLoginSuccess = (receivedToken, dbUsername) => {
        localStorage.setItem('token', receivedToken);
        localStorage.setItem('userName', dbUsername);
        setToken(receivedToken);
        setUserName(dbUsername || "User");
        setIsGuest(false);
        setIsLoggedIn(true);
    };

    const handleGuestLogin = () => {
        setIsGuest(true);
        setIsLoggedIn(true);
        const name = prompt("Hello Guest! Enter your name:") || "Guest";
        setUserName(name);
        setSessionsList([]);
        setChatHistory([{ role: "model", text: `Hello ${name}!` }]);
    };

    const startNewChat = async () => {
        setShowSidebar(false);
        if (isGuest) {
            setChatHistory([{ role: "model", text: `Hello ${userName}!` }]); 
            setActiveSessionId(null); 
            return; 
        }
        
        const res = await protectedFetch(`${API_BASE_URL}/sessions`, { method: 'POST', body: JSON.stringify({ session_name: 'New Chat' }) });
        if (res.ok) {
            const data = await res.json();
            setSessionsList(prev => [data.session, ...prev]);
            setActiveSessionId(data.session.session_id);
            setChatHistory([{ role: "model", text: `Hello ${userName}! Start a topic.` }]);
        }
    };

    const generateAIResponse = async () => {
        if (!userInput.trim() || isLoading) return;
        
        const userText = userInput.trim();
        setIsLoading(true);
        setUserInput("");
        
        const loaderId = Date.now();
        setChatHistory(prev => [...prev, { role: "user", text: userText }, { role: "model", text: "", id: loaderId }]);

        let historyPayload = [];
        if (isGuest) {
            historyPayload = chatHistory.filter(msg => msg.text && msg.text.trim() !== "").map(msg => ({ role: msg.role, text: msg.text }));
        }

        try {
            const response = await protectedFetch(`${API_BASE_URL}/chat`, {
                method: "POST",
                body: JSON.stringify({
                    prompt: userText,
                    mode: currentMode,
                    user_name: userName,
                    user_agent: userAgent,
                    session_id: isGuest ? (activeSessionId || tempGuestId) : activeSessionId,
                    history: isGuest ? historyPayload : []
                }),
            });

            const newSessionId = response.headers.get("x-session-id");
            if (newSessionId && isGuest) setActiveSessionId(Number(newSessionId));

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedText = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                accumulatedText += chunk;
                
                setChatHistory(prev => prev.map(msg => msg.id === loaderId ? { ...msg, text: accumulatedText } : msg));
            }
            accumulatedText += decoder.decode(); 
            setChatHistory(prev => prev.map(msg => msg.id === loaderId ? { ...msg, text: accumulatedText } : msg));

            // Refresh title list, but don't reload history (avoids vanishing/glitch)
            if (!isGuest) fetchSessions(false);

        } catch (error) {
            setChatHistory(prev => prev.map(msg => msg.id === loaderId ? { role: "model", text: "⚠️ Connection Error." } : msg));
        } finally { setIsLoading(false); }
    };

    useEffect(() => { if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight; }, [chatHistory]);

    return (
        <div className={`app-wrapper ${!isLoggedIn ? 'auth-view' : 'chat-view'}`}>
            {!isLoggedIn ? (
                <AuthView onLoginSuccess={handleLoginSuccess} onGuestLogin={handleGuestLogin} />
            ) : (
                <div className="chat-interface-container">
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
                                <div key={msg.id || i} className={`message ${msg.role === "user" ? "user" : "bot"} ${msg.text===""?"loading":""}`}>
                                    {msg.text==="" ? (
                                        <div className="typing-indicator">
                                            <div className="typing-dot"></div><div className="typing-dot"></div><div className="typing-dot"></div>
                                        </div>
                                    ) : msg.text}
                                </div>
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