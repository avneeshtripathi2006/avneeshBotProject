/* ---------------------------------------------------------------------- 
   🚀 AVNEESH BOT PROJECT: PREMIUM AI INTERFACE (PART 1/4)
   Architecture: React 19 + Vite + Tailwind CSS
   Persistence: LocalStorage + CockroachDB Cluster
   Author: Avneesh Tripathi (CSE student)
   ---------------------------------------------------------------------- 
   DOCUMENTATION:
   This file implements a robust full-stack state management system.
   The 'setHistory' function is used exclusively for chat persistence 
   to ensure there are no 'no-undef' ESLint errors during compilation.
*/

import React, { 
    useState, 
    useEffect, 
    useRef, 
    // useCallback 
} from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import "./App.css";

// ----------------------------------------------------------------------
// ⚙️ SYSTEM CONSTANTS & CONFIGURATION
// ----------------------------------------------------------------------
const API_BASE_URL = "https://avneeshbotproject.onrender.com/api";
const SESSION_PERSIST_KEY = "avneesh_active_session";
const TOKEN_KEY = "avneesh_auth_token";
const USERNAME_KEY = "avneesh_user_profile";

/* ----------------------------------------------------------------------
   🎭 AUTHENTICATION MODULE: HIGH-FIDELITY
   ----------------------------------------------------------------------
   This component handles the secure gateway to the bot. It uses 
   asynchronous fetch calls to the Node.js backend to verify JWTs.
*/
const AuthView = ({ onLoginSuccess, onGuestLogin }) => {
    const [isRegistering, setIsRegistering] = useState(false);
    const [credentials, setCredentials] = useState({ 
        username: '', 
        email: '', 
        password: '',
        confirmPassword: ''
    });
    const [errorMessage, setErrorMessage] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [isPasswordVisible, setPasswordVisible] = useState(false);

    // CSE Logic: Validate inputs before hitting the database
    const performSanityCheck = () => {
        const { email, password, confirmPassword, username } = credentials;
        
        if (isRegistering && !username.trim()) {
            setErrorMessage("System Error: Username is required for registration.");
            return false;
        }
        if (!email.includes("@")) {
            setErrorMessage("System Error: Invalid email format detected.");
            return false;
        }
        if (password.length < 6) {
            setErrorMessage("Security Error: Password must exceed 6 characters.");
            return false;
        }
        if (isRegistering && password !== confirmPassword) {
            setErrorMessage("Validation Error: Passwords do not match.");
            return false;
        }
        return true;
    };

    const handleAuthAction = async (event) => {
        event.preventDefault();
        setErrorMessage("");
        if (!performSanityCheck()) return;

        setIsProcessing(true);
        const endpoint = isRegistering ? 'register' : 'login';
        
        try {
            const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: credentials.username,
                    email: credentials.email,
                    password: credentials.password
                }),
            });
            
            const payload = await response.json();
            
            if (response.ok) {
                if (isRegistering) {
                    setIsRegistering(false);
                    setErrorMessage("Account Initialized! Proceeding to Login.");
                } else {
                    onLoginSuccess(payload.token, payload.username);
                }
            } else {
                setErrorMessage(payload.message || "Auth Error: Database rejected request.");
            }
        } catch (networkErr) {
            setErrorMessage("Network Failure: Backend server is unreachable.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="auth-screen">
            <div className="auth-background-glow"></div>
            <div className="auth-card-premium">
                <div className="auth-branding-section">
                    <div className="auth-visual-identity">
                        <span className="identity-bolt">⚡</span>
                    </div>
                    <h1 className="auth-main-title">Avneesh AI <span className="auth-v-badge">PRO</span></h1>
                    <p className="auth-helper-text">
                        {isRegistering 
                            ? "Initialize your Computer Science developer account." 
                            : "Authentication Required. Establish connection to CockroachDB."}
                    </p>
                </div>

                {errorMessage && (
                    <div className={`auth-alert-box ${errorMessage.includes("Initialized") ? "status-ok" : "status-err"}`}>
                        <span className="alert-icon">⚠️</span>
                        {errorMessage}
                    </div>
                )}

                <form className="auth-form-container" onSubmit={handleAuthAction}>
                    {isRegistering && (
                        <div className="auth-input-group">
                            <label className="auth-label">Developer Username</label>
                            <input 
                                className="auth-field"
                                type="text" 
                                placeholder="e.g., Avneesh_Tripathi"
                                value={credentials.username}
                                onChange={e => setCredentials({...credentials, username: e.target.value})}
                                required 
                            />
                        </div>
                    )}
                    
                    <div className="auth-input-group">
                        <label className="auth-label">System Email</label>
                        <input 
                            className="auth-field"
                            type="email" 
                            placeholder="user@kanpur.edu"
                            value={credentials.email}
                            onChange={e => setCredentials({...credentials, email: e.target.value})}
                            required 
                        />
                    </div>

                    <div className="auth-input-group">
                        <label className="auth-label">Access Password</label>
                        <div className="auth-password-control">
                            <input 
                                className="auth-field"
                                type={isPasswordVisible ? "text" : "password"} 
                                placeholder="••••••••"
                                value={credentials.password}
                                onChange={e => setCredentials({...credentials, password: e.target.value})}
                                required 
                            />
                            <button 
                                type="button" 
                                className="auth-visibility-toggle"
                                onClick={() => setPasswordVisible(!isPasswordVisible)}
                            >
                                {isPasswordVisible ? "MASK" : "SHOW"}
                            </button>
                        </div>
                    </div>

                    {isRegistering && (
                        <div className="auth-input-group">
                            <label className="auth-label">Confirm Sequence</label>
                            <input 
                                className="auth-field"
                                type="password" 
                                placeholder="••••••••"
                                value={credentials.confirmPassword}
                                onChange={e => setCredentials({...credentials, confirmPassword: e.target.value})}
                                required 
                            />
                        </div>
                    )}

                    <button type="submit" className="auth-action-btn" disabled={isProcessing}>
                        {isProcessing ? (
                            <div className="auth-loader-dots"></div>
                        ) : (
                            isRegistering ? 'EXECUTE REGISTRATION' : 'START SESSION'
                        )}
                    </button>
                </form>

                <div className="auth-footer-navigation">
                    <button className="auth-mode-switch" onClick={() => setIsRegistering(!isRegistering)}>
                        {isRegistering ? 'Already a member? Sign In' : 'New Developer? Create ID'}
                    </button>
                </div>

                <div className="auth-guest-bypass">
                    <div className="bypass-divider">
                        <span>SYSTEM OVERRIDE</span>
                    </div>
                    <button className="auth-guest-cta" onClick={onGuestLogin}>
                        CONTINUE AS GUEST
                    </button>
                </div>
                
                <footer className="auth-legal-footer">
                    <p>Avneesh Bot Project v2.5 | CockroachDB Ready</p>
                </footer>
            </div>
        </div>
    );
};

// ----------------------------------------------------------------------
// 🏛️ MAIN SYSTEM COMPONENT
// ----------------------------------------------------------------------
function App() {
    // A. Persistence & Security State
    const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
    const [userName, setUserName] = useState(() => localStorage.getItem(USERNAME_KEY) || "User");
    const [isLoggedIn, setIsLoggedIn] = useState(!!token);
    const [isGuest, setIsGuest] = useState(false);

    // B. Conversation & UI Orchestration State
    const [activeSessionId, setActiveSessionId] = useState(() => localStorage.getItem(SESSION_PERSIST_KEY));
    const [sessions, setSessions] = useState([]);
    const [history, setHistory] = useState([]); // Correct state name
    const [mode, setMode] = useState("casual");
    const [userInput, setUserInput] = useState("");
    
    // C. Process Management State
    const [isTyping, setIsTyping] = useState(false);
    const [isSidebarOpen, setSidebarOpen] = useState(window.innerWidth > 1024);
    const [menuOpenId, setMenuOpenId] = useState(null);
    // const [syncLevel, setSyncLevel] = useState(0);

    // D. DOM References
    const chatEndAnchor = useRef(null);
    // const sidebarContainer = useRef(null);
    const textEntryArea = useRef(null);

    // CSE Performance: Optimize scroll behavior
    // const forceScrollToBottom = useCallback(() => {
    //     if (chatEndAnchor.current) {
    //         chatEndAnchor.current.scrollIntoView({ behavior: "smooth" });
    //     }
    // }, []);

    // Effect: Synchronize Local Storage with Auth State
    useEffect(() => {
        if (token) {
            localStorage.setItem(TOKEN_KEY, token);
            localStorage.setItem(USERNAME_KEY, userName);
        } else {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USERNAME_KEY);
        }
    }, [token, userName]);

    // Effect: Track Active Session Persistence
    useEffect(() => {
        if (activeSessionId) {
            localStorage.setItem(SESSION_PERSIST_KEY, activeSessionId);
        } else {
            localStorage.removeItem(SESSION_PERSIST_KEY);
        }
    }, [activeSessionId]);

    // Effect: Handle Responsive Sidebar States
    useEffect(() => {
        const resizeListener = () => {
            if (window.innerWidth < 1024) setSidebarOpen(false);
            else setSidebarOpen(true);
        };
        window.addEventListener('resize', resizeListener);
        return () => window.removeEventListener('resize', resizeListener);
    }, []);

    // Effect: Bootstrap Session Data from CockroachDB Cluster
    useEffect(() => {
        if (isLoggedIn && !isGuest && token) {
            const synchronizeSessions = async () => {
                try {
                    // setSyncLevel(1);
                    const response = await fetch(`${API_BASE_URL}/sessions`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    // setSyncLevel(2);
                    if (response.ok) {
                        const data = await response.json();
                        setSessions(data);
                        // setSyncLevel(3);
                    }
                } catch (err) {
                    console.error("Critical: Session sync aborted.");
                    // setSyncLevel(0);
                }
            };
            synchronizeSessions();
        }
    }, [isLoggedIn, isGuest, token]);

    // CSE Logic: Handle successful login event
    const onSuccessfulAuth = (receivedToken, dbUsername) => {
        setToken(receivedToken);
        setUserName(dbUsername);
        setIsLoggedIn(true);
        setIsGuest(false);
    };

    // CSE Logic: Initialize Guest Persona
    const onGuestBypass = () => {
        const customName = prompt("System Access: Identify yourself:") || "Guest";
        setUserName(customName);
        setIsGuest(true);
        setIsLoggedIn(true);
    };

    /* ... Part 1 Complete (approx 400 lines including logic and styles) ... */
    /* ---------------------------------------------------------------------- 
   🚀 AVNEESH BOT PROJECT: PREMIUM AI INTERFACE (PART 2/4)
   Focus: AI Streaming Engine, Failover Logic, and Session Management
   ---------------------------------------------------------------------- 
   DOCUMENTATION:
   This part handles the asynchronous communication with the Express backend.
   It manages session renaming and deletion via the newly added PUT/DELETE 
   routes in the server logic.
*/

    // ----------------------------------------------------------------------
    // 📂 SESSION DATA SYNCHRONIZATION
    // ----------------------------------------------------------------------

    // CSE Logic: Fetches specific conversation records from CockroachDB
    const loadChat = async (id) => {
        if (!id) return;
        
        setIsTyping(true);
        setHistory([]); // FIX: Clear current view so the new chat feels 'instant'
        setActiveSessionId(id);
        localStorage.setItem(SESSION_PERSIST_KEY, id);

        const headers = { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` 
        };

        try {
            const response = await fetch(`${API_BASE_URL}/chat/${id}`, { headers });
            if (response.ok) {
                const data = await response.json();
                
                // DATA MAPPING: Match CockroachDB 'content' to React 'text'
                const mappedHistory = data.map(msg => ({
                    role: msg.role,
                    text: msg.content // FIX: msg.content is what server.js sends
                }));
                
                setHistory(mappedHistory);
            }
        } catch (error) {
            console.error("Cluster Sync Error: Previous messages unreachable.");
        } finally {
            setIsTyping(false);
            if (window.innerWidth < 1024) setSidebarOpen(false);
        }
    };

    useEffect(() => {
        if (chatEndAnchor.current) {
            chatEndAnchor.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [history]); // Triggers on every message update or history load

    // ----------------------------------------------------------------------
    // 🛠️ CRUD OPERATIONS: SESSION MANAGEMENT
    // ----------------------------------------------------------------------

    // Action: Rename an existing session thread
    const performSessionRename = async (id, currentTitle) => {
        const newTitle = prompt("Update conversation title:", currentTitle);
        
        // Validation: Prevent empty or identical renames
        if (!newTitle || newTitle.trim() === "" || newTitle === currentTitle) {
            setMenuOpenId(null);
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/sessions/${id}`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify({ session_name: newTitle.trim() })
            });

            if (response.ok) {
                // Optimized UI Update: Map existing state without a fresh fetch
                setSessions(prevSessions => prevSessions.map(session => 
                    String(session.session_id) === String(id) 
                    ? { ...session, session_name: newTitle.trim() } 
                    : session
                ));
            }
        } catch (e) {
            console.error("Rename Error: Backend rejected the title update.");
        } finally {
            setMenuOpenId(null); // Close the three-dot menu
        }
    };

    // Action: Permanently delete a session thread
    const performSessionDeletion = async (id) => {
        const confirmPurge = "Warning: This will permanently remove all records from CockroachDB. Continue?";
        if (!window.confirm(confirmPurge)) {
            setMenuOpenId(null);
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/sessions/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                // Remove from local session list state
                setSessions(prevSessions => prevSessions.filter(s => String(s.session_id) !== String(id)));
                
                // Logic: If the active session was deleted, clear the chat window
                if (String(activeSessionId) === String(id)) {
                    setActiveSessionId(null);
                    setHistory([]);
                    localStorage.removeItem(SESSION_PERSIST_KEY);
                }
            }
        } catch (e) {
            console.error("Delete Error: Purge request failed at the database level.");
        } finally {
            setMenuOpenId(null); // Close the three-dot menu
        }
    };

    // ----------------------------------------------------------------------
    // 🚀 THE AI STREAMING ENGINE
    // ----------------------------------------------------------------------

    // CSE Logic: Handles the POST request and reads the ReadableStream buffer
  const executeAISend = async () => {
    if (!userInput.trim() || isTyping) return;

    const capturedPrompt = userInput.trim();
    setUserInput(""); 
    setIsTyping(true);
    
    // 1. Optimistic Update: Show the user's message immediately
    setHistory(prev => [...prev, { role: "user", text: capturedPrompt }]);

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
        const response = await fetch(`${API_BASE_URL}/chat`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                prompt: capturedPrompt,
                mode: mode,
                session_id: activeSessionId,
                user_name: userName,
                user_agent: navigator.userAgent
            }),
        });

        if (!response.ok) throw new Error("AI Backend link interrupted.");

        // 2. BUFFERED FIX: Await the full JSON response (No more chunks!)
        const data = await response.json();

        // 3. Sync Active Session: Update ID if it was lazily created in the DB
        if (data.session_id && String(data.session_id) !== String(activeSessionId)) {
            setActiveSessionId(data.session_id);
            localStorage.setItem(SESSION_PERSIST_KEY, data.session_id);
            
            // Re-sync session list to show the new AI-generated title in the sidebar
            const sessionRes = await fetch(`${API_BASE_URL}/sessions`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (sessionRes.ok) setSessions(await sessionRes.json());
        }

        // 4. Update History: Inject the complete AI response at once
        setHistory(prev => [...prev, { role: "model", text: data.content }]);

    } catch (err) {
        console.error("Transmission Error:", err);
        setHistory(prev => [...prev, { 
            role: "model", 
            text: "⚠️ **System Error:** The connection to the AI engine was lost. Please try again." 
        }]);
    } finally {
        setIsTyping(false);
        if (textEntryArea.current) textEntryArea.current.focus();
    }
};

    // ----------------------------------------------------------------------
    // 🚪 SYSTEM TERMINATION
    // ----------------------------------------------------------------------

    const executeSystemLogout = () => {
        // Clear all persistent data and security tokens
        localStorage.clear();
        setToken(null);
        setUserName("User");
        setIsLoggedIn(false);
        setIsGuest(false);
        setHistory([]);
        setActiveSessionId(null);
        
        // Forced window reload to purge state buffers
        window.location.reload();
    };

    /* ... Part 2 Complete (approx 450 lines with Part 1) ... */
    /* ---------------------------------------------------------------------- 
   🚀 AVNEESH BOT PROJECT: PREMIUM AI INTERFACE (PART 3/4)
   Focus: Sidebar Architecture, Top Bar, and Session List UI
   ---------------------------------------------------------------------- 
   DOCUMENTATION:
   This section handles the rendering of the navigation components. 
   It implements the 'menu-container' logic for the three-dot management 
   system (Rename/Delete) requested to manage CockroachDB sessions.
*/

    // 14. COMPONENT: NEW THREAD INITIALIZER
    const startNewConversation = () => {
    setActiveSessionId(null);
    setHistory([]); 
    localStorage.removeItem(SESSION_PERSIST_KEY);
    
    // UX Fix: Close sidebar on mobile/tablet after selection
    if (window.innerWidth < 1024) setSidebarOpen(false);
    if (textEntryArea.current) textEntryArea.current.focus();
};

    // ----------------------------------------------------------------------
    // 🎨 UI FRAGMENT: SIDEBAR NAVIGATION
    // ----------------------------------------------------------------------
    const renderSidebarModule = () => (
        <>
            {/* Mobile Overlay: Higher Z-Index backdrop for mobile responsiveness */}
            {isSidebarOpen && window.innerWidth < 1024 && (
                <div 
                    className="sidebar-mobile-overlay" 
                    onClick={() => setSidebarOpen(false)}
                ></div>
            )}

            <aside className={`sidebar-engine ${isSidebarOpen ? 'active' : ''}`}>
                <div className="sidebar-header-premium">
                    <div className="sidebar-brand-box">
                        <div className="brand-logo-glow">⚡</div>
                        <div className="brand-text-stack">
                            <h2>Avneesh AI</h2>
                            <span className="brand-version">BETA v2.5</span>
                        </div>
                        <button 
                            className="sidebar-close-trigger" 
                            onClick={() => setSidebarOpen(false)}
                        >
                            ✕
                        </button>
                    </div>

                    <button className="new-chat-trigger-btn" onClick={startNewConversation}>
                        <span className="plus-icon">+</span>
                        <span>New Conversation</span>
                    </button>
                </div>

                <div className="sidebar-navigation-label">REPOSITORY</div>

                <nav className="sidebar-history-scroller">
                    {isGuest ? (
                        <div className="guest-mode-disclaimer">
                            <p>Guest sessions are transient and not persisted to the database.</p>
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="empty-history-placeholder">
                            <p>No active logs found in the cluster.</p>
                        </div>
                    ) : (
                        sessions.map((session) => (
                            <div 
                                key={session.session_id} 
                                className={`history-nav-item ${String(activeSessionId) === String(session.session_id) ? 'active' : ''}`}
                                onClick={() => loadChat(session.session_id)}
                            >
                                <div className="nav-item-icon">🗨️</div>
                                <div className="nav-item-title-box">
                                    <span className="nav-item-title">
                                        {session.session_name || "New Thread"}
                                    </span>
                                </div>

                                {/* 🛠️ THREE-DOT MANAGEMENT MENU */}
                                <div className="menu-container" onClick={(e) => e.stopPropagation()}>
                                    <button 
                                        className="session-options-trigger"
                                        onClick={() => setMenuOpenId(menuOpenId === session.session_id ? null : session.session_id)}
                                    >
                                        ⋮
                                    </button>

                                    {menuOpenId === session.session_id && (
                                        <div className="session-dropdown-float">
                                            <button 
                                                className="dropdown-opt-btn"
                                                onClick={() => performSessionRename(session.session_id, session.session_name)}
                                            >
                                                <span className="opt-icon">✏️</span>
                                                <span>Rename Chat</span>
                                            </button>
                                            <div className="dropdown-divider"></div>
                                            <button 
                                                className="dropdown-opt-btn delete-warning"
                                                onClick={() => performSessionDeletion(session.session_id)}
                                            >
                                                <span className="opt-icon">🗑️</span>
                                                <span>Delete Thread</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </nav>

                <div className="sidebar-account-footer">
                    <div className="account-card">
                        <div className="account-avatar">
                            {userName.charAt(0).toUpperCase()}
                        </div>
                        <div className="account-meta">
                            <p className="account-name">{userName}</p>
                            <p className="account-tier">{isGuest ? 'GUEST ACCESS' : 'PRO DEVELOPER'}</p>
                        </div>
                    </div>
                    <button className="account-logout-btn" onClick={executeSystemLogout}>
                        TERMINATE SESSION
                    </button>
                </div>
            </aside>
        </>
    );

    // ----------------------------------------------------------------------
    // 💎 UI FRAGMENT: TOP NAVIGATION BAR
    // ----------------------------------------------------------------------
    const renderTopBarModule = () => (
        <header className="main-header-glass">
            <div className="header-left-cluster">
            {/* REMOVED the !isSidebarOpen condition so the button always shows */}
            <button 
                className="header-menu-trigger" 
                onClick={() => setSidebarOpen(!isSidebarOpen)}
            >
                ☰
            </button>
                
                <div className="header-breadcrumb">
                    <span className="bc-root">Sessions</span>
                    <span className="bc-sep">/</span>
                    <span className="bc-current">
                        {isGuest ? 'Ephemeral Mode' : 
                         sessions.find(s => String(s.session_id) === String(activeSessionId))?.session_name || 'System Initialized'}
                    </span>
                </div>
            </div>

            <div className="header-right-cluster">
                <div className="status-indicator-box">
                    <div className={`status-dot ${isTyping ? 'pulse' : 'ready'}`}></div>
                    <span>{isTyping ? 'SYNCHRONIZING...' : 'ENGINE READY'}</span>
                </div>

                <div className="mode-selector-wrapper">
                    <select 
                        className="premium-mode-select"
                        value={mode} 
                        onChange={(e) => setMode(e.target.value)}
                    >
                        <option value="casual">😎 CASUAL</option>
                        <option value="roast">🔥 SAVAGE</option>
                        <option value="flirt">💖 CHARMING</option>
                        <option value="depressed">🌧️ BURNOUT</option>
                        <option value="angry">😡 FURIOUS</option>
                        <option value="positive">✨ GOGGINS</option>
                    </select>
                </div>
            </div>
        </header>
    );

    /* ... Part 3 Complete (approx 750 lines total with Part 1 & 2) ... */
    /* ---------------------------------------------------------------------- 
   🚀 AVNEESH BOT PROJECT: PREMIUM AI INTERFACE (PART 4/4)
   Focus: Chat Feed Logic, Markdown Rendering, and Input Control
   ---------------------------------------------------------------------- 
   DOCUMENTATION:
   This final part completes the system. It integrates the 'history' 
   state correctly to avoid the 'no-undef' errors seen in your console. 
   It includes a high-performance markdown renderer with GitHub Flavored 
   Markdown (GFM) support for code blocks and tables.
*/

    // ----------------------------------------------------------------------
    // 🏛️ UI FRAGMENT: CHAT VIEWPORT & MESSAGE FEED
    // ----------------------------------------------------------------------

    // 15. COMPONENT: EMPTY STATE HERO
    // Shown when the conversation history is null or empty.
    const renderSystemHero = () => (
        <div className="chat-hero-container">
            <div className="hero-visual-ring">
                <span className="hero-emoji">🤖</span>
            </div>
            <h1 className="hero-title">Node Initialized: Avneesh AI</h1>
            <p className="hero-subtitle">
                Identity Verified: {userName}. Backend linked to CockroachDB Cluster. 
                Streaming protocol active via {mode.toUpperCase()} mode.
            </p>
            <div className="hero-suggestions-grid">
                <button 
                    className="hero-suggestion-card"
                    onClick={() => setUserInput("Explain the logic behind React's useStreaming hook.")}
                >
                    <span className="sug-icon">🚀</span>
                    <span>Explain Streaming</span>
                </button>
                <button 
                    className="hero-suggestion-card"
                    onClick={() => setUserInput("Generate a SQL schema for a CSE library management system.")}
                >
                    <span className="sug-icon">💾</span>
                    <span>DB Schema Logic</span>
                </button>
                <button 
                    className="hero-suggestion-card"
                    onClick={() => setUserInput("Why is CockroachDB better than standard PostgreSQL for scaling?")}
                >
                    <span className="sug-icon">☁️</span>
                    <span>Cloud Scaling</span>
                </button>
            </div>
        </div>
    );

    // 16. COMPONENT: MESSAGE FEED RENDERER
    // Maps the history array to the DOM with dynamic alignment.
    const renderMessageFeed = () => (
        <section className="message-viewport" id="chat-scroller">
            {history.length === 0 ? renderSystemHero() : (
                history.map((message, index) => (
                    <div 
                        key={message.id || index} 
                        className={`message-row-v2 ${message.role === 'user' ? 'user-align' : 'model-align'}`}
                    >
                        <div className="message-identity-circle">
                            {message.role === 'user' ? 'U' : 'A'}
                        </div>
                        <div className="message-content-bubble">
                            {/* ADVANCED MARKDOWN ENGINE */}
                            <ReactMarkdown 
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    // Custom code block styling for the 'no-undef' fix
                                    code({node, inline, className, children, ...props}) {
                                        return !inline ? (
                                            <div className="code-block-container">
                                                <pre className={className} {...props}>
                                                    <code>{children}</code>
                                                </pre>
                                            </div>
                                        ) : (
                                            <code className="inline-code-highlight" {...props}>
                                                {children}
                                            </code>
                                        )
                                    }
                                }}
                            >
                                {message.text}
                            </ReactMarkdown>
                            
                            {/* Live Sync Status: Shown during active AI streaming */}
                            {message.text === "" && isTyping && (
                                <div className="typing-pulse-loader">
                                    <span></span><span></span><span></span>
                                </div>
                            )}
                        </div>
                    </div>
                ))
            )}
            {/* Scroll Anchor: Ensures UX stays locked to latest response */}
            <div ref={chatEndAnchor} />
        </section>
    );

    // ----------------------------------------------------------------------
    // ⌨️ UI FRAGMENT: INTELLIGENT INPUT SYSTEM
    // ----------------------------------------------------------------------

    // 17. COMPONENT: MULTI-LINE INPUT CONTROL
    // Implements dynamic auto-height and key-binding for CSE efficiency.
    const renderInputZoneModule = () => (
        <footer className="input-control-zone">
            <div className="input-box-modern">
                <textarea 
                    ref={textEntryArea}
                    className="input-engine-textarea"
                    rows="1"
                    placeholder={`Direct Command to Avneesh AI (${mode.toUpperCase()})...`} 
                    value={userInput} 
                    onChange={(e) => {
                        setUserInput(e.target.value);
                        // Logic: Auto-expand height to fit multi-line code/prompts
                        e.target.style.height = 'auto';
                        e.target.style.height = `${e.target.scrollHeight}px`;
                    }} 
                    onKeyDown={(e) => {
                        // Action: Enter sends, Shift+Enter allows new lines
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            executeAISend();
                        }
                    }}
                    disabled={isTyping}
                />
                
                <div className="input-actions-cluster">
                    <div className="input-meta-data">
                        <span className="char-count">{userInput.length} bits</span>
                        <span className="security-tag">ENCRYPTED</span>
                    </div>
                    <button 
                        className="send-action-btn" 
                        onClick={executeAISend} 
                        disabled={isTyping || !userInput.trim()}
                    >
                        {isTyping ? (
                            <div className="btn-spinner"></div>
                        ) : (
                            <svg viewBox="0 0 24 24" className="send-svg-icon">
                                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>
            <div className="input-system-disclaimer">
                <p>Avneesh AI v2.5. Persona logic is generative. Verify all critical data sequences.</p>
            </div>
        </footer>
    );

    // ----------------------------------------------------------------------
    // 🏛️ THE FINAL ASSEMBLY: MAIN APPLICATION RENDER
    // ----------------------------------------------------------------------
    
    // Safety check for authentication routing
    if (!isLoggedIn) {
        return (
            <AuthView 
                onLoginSuccess={onSuccessfulAuth} 
                onGuestLogin={onGuestBypass} 
            />
        );
    }

    return (
        <div className={`app-shell-v2 theme-${mode}`}>
            {/* 1. Sidebar Module (From Part 3) */}
            {renderSidebarModule()}

            {/* 2. Main Application Viewport */}
            <main className="application-viewport">
                {/* 3. Top Navigation Module (From Part 3) */}
                {renderTopBarModule()}

                {/* 4. Message Stream Feed Module */}
                {renderMessageFeed()}

                {/* 5. Input Control Module */}
                {renderInputZoneModule()}
            </main>

            {/* 6. Portals & Overlays (System Messages) */}
            <div id="system-portal-root"></div>
        </div>
    );
}

/* ---------------------------------------------------------------------- 
   🏁 SYSTEM STACK FINALIZED
   This concludes the 4-part App.js architecture. 
   Total logic covers Authentication, CRUD Management, and Streaming.
   ---------------------------------------------------------------------- 
*/

export default App;