import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import './App.css';

// ── Avatars ───────────────────────────────────────────────────────────────────

const BotAvatar = () => (
  <div className="avatar bot-avatar">
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="8" width="18" height="12" rx="3" fill="currentColor" opacity="0.15"/>
      <rect x="3" y="8" width="18" height="12" rx="3" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="9" cy="14" r="1.5" fill="currentColor"/>
      <circle cx="15" cy="14" r="1.5" fill="currentColor"/>
      <path d="M9 4h6M12 4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="12" cy="3.5" r="1" fill="currentColor"/>
    </svg>
  </div>
);

const UserAvatar = ({ name }) => (
  <div className="avatar user-avatar" title={name || 'User'}>
    {name ? (
      <span className="avatar-initial">{name.charAt(0).toUpperCase()}</span>
    ) : (
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )}
  </div>
);

const TypingDots = () => (
  <div className="typing-dots">
    <span /><span /><span />
  </div>
);

// ── Configuration & Helpers ───────────────────────────────────────────────────

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const getTime = () =>
  new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });

const genId = () => `session_${Date.now()}`;

const SUGGESTIONS = [
  'What is this document about?',
  'Explain ACID properties in DBMS',
  'What is paging and virtual memory in OS?',
  'What is Kubernetes and how does it work?',
];

const USER_KEY = 'rag_user';
const TOKEN_KEY = 'rag_token';

const getUserStorageKey = (currentUser) => {
  return currentUser?.id ? `rag_sessions_user_${currentUser.id}` : 'rag_sessions_guest';
};

function loadStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY)) || null;
  } catch {
    return null;
  }
}

function loadStoredSessions(currentUser) {
  try {
    const key = getUserStorageKey(currentUser);
    const data = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
  } catch {}
  return [];
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {

  const [user, setUser] = useState(loadStoredUser);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState('login'); // 'login' | 'signup'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [sessions, setSessions] = useState(() => {
    const initialUser = loadStoredUser();
    const stored = loadStoredSessions(initialUser);
    if (stored.length > 0) return stored;
    const id = genId();
    const now = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
    return [{ id, title: 'New Chat', date: now, messages: [] }];
  });
  const [activeId, setActiveId] = useState(() => sessions[0]?.id || null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [backendStatus, setBackendStatus] = useState('checking'); // 'checking' | 'connected' | 'offline'
  const [groqConfigured, setGroqConfigured] = useState(true);
  const [dbConnected, setDbConnected] = useState(false);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Active session
  const activeSession = sessions.find(s => s.id === activeId) || null;
  const messages = activeSession?.messages || [];

  // Remove legacy shared localStorage key once on mount to prevent cross-account chat leaks
  useEffect(() => {
    if (localStorage.getItem('rag_sessions')) {
      localStorage.removeItem('rag_sessions');
    }
  }, []);

  // Save sessions to user-scoped localStorage
  useEffect(() => {
    const key = getUserStorageKey(user);
    if (sessions && sessions.length > 0) {
      localStorage.setItem(key, JSON.stringify(sessions));
    }
  }, [sessions, user]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Periodic Backend & Database Health Check
  useEffect(() => {
    let isMounted = true;
    const checkHealth = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        if (response.ok) {
          const data = await response.json();
          if (isMounted) {
            setBackendStatus('connected');
            setGroqConfigured(data.groq_configured);
            setDbConnected(Boolean(data.database_connected));
          }
        } else {
          if (isMounted) setBackendStatus('offline');
        }
      } catch (err) {
        if (isMounted) setBackendStatus('offline');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Fetch user sessions from Neon DB when authenticated
  const fetchDBSessions = async (authToken, targetUser) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/sessions`, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          if (data.length > 0) {
            setSessions(data);
            setActiveId(data[0].id);
            localStorage.setItem(getUserStorageKey(targetUser), JSON.stringify(data));
          } else {
            // New user with no chats in DB yet: start fresh clean session for this user
            const id = genId();
            const now = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
            const freshSession = [{ id, title: 'New Chat', date: now, messages: [] }];
            setSessions(freshSession);
            setActiveId(id);
            localStorage.setItem(getUserStorageKey(targetUser), JSON.stringify(freshSession));
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load sessions from DB:', e);
    }
  };

  useEffect(() => {
    if (token && user) {
      fetchDBSessions(token, user);
    }
  }, [token]);

  // ── Authentication Handlers ─────────────────────────────────────────────────

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    try {
      const endpoint = authTab === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const body = authTab === 'login'
        ? { email: authEmail, password: authPassword }
        : { email: authEmail, password: authPassword, username: authUsername };

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Authentication failed.');
      }

      // Save user & token
      setUser(data.user);
      setToken(data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      localStorage.setItem(TOKEN_KEY, data.token);

      // Immediately switch session state to this user's stored sessions
      const userStored = loadStoredSessions(data.user);
      if (userStored.length > 0) {
        setSessions(userStored);
        setActiveId(userStored[0].id);
      } else {
        const id = genId();
        const now = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
        setSessions([{ id, title: 'New Chat', date: now, messages: [] }]);
        setActiveId(id);
      }

      setAuthModalOpen(false);
      setAuthPassword('');
      setAuthEmail('');
      setAuthUsername('');

      fetchDBSessions(data.token, data.user);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);

    // Switch to clean guest session
    const guestStored = loadStoredSessions(null);
    if (guestStored.length > 0) {
      setSessions(guestStored);
      setActiveId(guestStored[0].id);
    } else {
      const id = genId();
      const now = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
      const guestSession = [{ id, title: 'New Chat', date: now, messages: [] }];
      setSessions(guestSession);
      setActiveId(id);
    }
    setInput('');
  };

  // ── Create New Chat ─────────────────────────────────────────────────────────

  const createNewChat = () => {
    const id = genId();
    const now = new Date().toLocaleDateString([], {
      month: 'short',
      day: 'numeric'
    });

    const newSession = {
      id,
      title: 'New Chat',
      date: now,
      messages: []
    };

    setSessions(prev => [newSession, ...prev]);
    setActiveId(id);
    setInput('');
    inputRef.current?.focus();

    // Register session on backend if authenticated
    if (token) {
      fetch(`${API_BASE_URL}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ id, title: 'New Chat' })
      }).catch(() => {});
    }
  };

  // ── Delete Session ──────────────────────────────────────────────────────────

  const deleteSession = (id) => {
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== id);
      if (activeId === id) {
        setActiveId(updated[0]?.id || null);
      }
      return updated;
    });
    setConfirmDeleteId(null);

    // Delete from Neon DB if authenticated
    if (token) {
      fetch(`${API_BASE_URL}/api/sessions/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      }).catch(() => {});
    }
  };

  // ── Update Session ──────────────────────────────────────────────────────────

  const updateSession = (id, newMessages) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== id) return s;
      const firstUser = newMessages.find(m => m.type === 'user');
      const title = firstUser
        ? firstUser.text.slice(0, 36) + (firstUser.text.length > 36 ? '…' : '')
        : s.title;

      return {
        ...s,
        title,
        messages: newMessages
      };
    }));
  };

  // ── Ask Question ────────────────────────────────────────────────────────────

  const askQuestion = async () => {
    const question = input.trim();
    if (!question || loading) return;

    let sessionId = activeId;
    let sessionTitle = activeSession?.title || 'New Chat';

    // Create session if none exists
    if (!sessionId) {
      sessionId = genId();
      sessionTitle = question.slice(0, 36) + (question.length > 36 ? '…' : '');
      const now = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
      const newSession = { id: sessionId, title: sessionTitle, date: now, messages: [] };
      setSessions(prev => [newSession, ...prev]);
      setActiveId(sessionId);
    }

    const userMsg = { type: 'user', text: question, time: getTime() };
    const thinkingMsg = { type: 'bot', text: '', time: '', thinking: true };
    const nextMsgs = [...messages, userMsg, thinkingMsg];

    updateSession(sessionId, nextMsgs);
    setInput('');
    setLoading(true);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${API_BASE_URL}/ask`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question,
          session_id: sessionId,
          session_title: sessionTitle
        })
      });

      setBackendStatus('connected');
      const data = await response.json();

      const updatedMsgs = nextMsgs.map(msg =>
        msg.thinking
          ? {
              type: 'bot',
              text: data.answer || 'No response received',
              sources: data.sources || [],
              time: getTime()
            }
          : msg
      );

      updateSession(sessionId, updatedMsgs);
    } catch (error) {
      console.error(error);
      setBackendStatus('offline');

      const updatedMsgs = nextMsgs.map(msg =>
        msg.thinking
          ? {
              type: 'bot',
              text: '⚠️ Could not connect to backend. Please ensure the local backend server is running.',
              time: getTime()
            }
          : msg
      );

      updateSession(sessionId, updatedMsgs);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askQuestion();
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="shell">

      {/* Auth Modal (Login / Sign Up) */}
      {authModalOpen && (
        <div className="modal-backdrop" onClick={() => setAuthModalOpen(false)}>
          <div className="auth-modal" onClick={e => e.stopPropagation()}>
            <div className="auth-header">
              <h3>{authTab === 'login' ? 'Sign In' : 'Create Account'}</h3>
              <button className="close-btn" onClick={() => setAuthModalOpen(false)}>✕</button>
            </div>

            <div className="auth-tabs">
              <button
                className={`tab-btn ${authTab === 'login' ? 'active' : ''}`}
                onClick={() => { setAuthTab('login'); setAuthError(null); }}
              >
                Sign In
              </button>
              <button
                className={`tab-btn ${authTab === 'signup' ? 'active' : ''}`}
                onClick={() => { setAuthTab('signup'); setAuthError(null); }}
              >
                Sign Up
              </button>
            </div>

            {authError && (
              <div className="auth-error-banner">
                <span>⚠️ {authError}</span>
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="auth-form">
              {authTab === 'signup' && (
                <div className="form-group">
                  <label>Full Name / Username</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Harish Reddy"
                    value={authUsername}
                    onChange={e => setAuthUsername(e.target.value)}
                  />
                </div>
              )}

              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={authEmail}
                  onChange={e => setAuthEmail(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="At least 6 characters"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                />
              </div>

              <button type="submit" className="auth-submit-btn" disabled={authLoading}>
                {authLoading ? 'Please wait...' : (authTab === 'login' ? 'Sign In' : 'Create Account')}
              </button>
            </form>

            <div className="auth-footer-prompt">
              <button
                type="button"
                className="guest-link"
                onClick={() => setAuthModalOpen(false)}
              >
                Continue as Guest
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>

        {/* Sidebar Header */}
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-icon">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
            </div>
            {sidebarOpen && (
              <span className="brand-name">
                Local RAG Assistant
              </span>
            )}
          </div>

          <button
            className="icon-btn"
            onClick={() => setSidebarOpen(o => !o)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            ✕
          </button>
        </div>

        {/* New Chat */}
        <button className="new-chat-btn" onClick={createNewChat}>
          + New Chat
        </button>

        {/* Session List */}
        {sidebarOpen && (
          <div className="session-list">
            {sessions.map(s => (
              <div
                key={s.id}
                className={`session-item ${s.id === activeId ? 'active' : ''}`}
                onClick={() => {
                  setActiveId(s.id);
                  setConfirmDeleteId(null);
                }}
              >
                <div className="session-meta">
                  <span className="session-title">{s.title}</span>
                  <span className="session-date">{s.date}</span>
                </div>

                {confirmDeleteId === s.id ? (
                  <div className="delete-confirm">
                    <button onClick={() => deleteSession(s.id)}>Delete</button>
                    <button onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                  </div>
                ) : (
                  <button
                    className="delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(s.id);
                    }}
                    title="Delete chat"
                  >
                    🗑
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* User Card in Sidebar */}
        {sidebarOpen && (
          <div className="sidebar-user-section">
            {user ? (
              <div className="user-profile-card">
                <div className="user-info">
                  <span className="user-avatar-badge">{user.username.charAt(0).toUpperCase()}</span>
                  <div className="user-text">
                    <span className="user-name">{user.username}</span>
                    <span className="user-email">{user.email}</span>
                  </div>
                </div>
                <button className="logout-btn" onClick={handleLogout} title="Sign Out">
                  Logout
                </button>
              </div>
            ) : (
              <button
                className="login-trigger-btn"
                onClick={() => { setAuthTab('login'); setAuthModalOpen(true); }}
              >
                🔐 Sign In / Register
              </button>
            )}
          </div>
        )}

        {/* Footer */}
        {sidebarOpen && (
          <div className="sidebar-footer">
            <span className={`status-badge status-${backendStatus}`}>
              <span className={`status-dot status-dot-${backendStatus}`} />
              {backendStatus === 'connected'
                ? (dbConnected ? 'Neon DB & RAG Online' : 'Backend Connected')
                : backendStatus === 'checking'
                ? 'Connecting...'
                : 'Backend Offline'}
            </span>
          </div>
        )}
      </aside>

      {/* Main Area */}
      <div className="main">

        {/* Topbar */}
        <header className="topbar">
          <span className="topbar-title">
            {activeSession ? activeSession.title : 'Local RAG Assistant'}
          </span>

          <div className="topbar-actions">
            {user ? (
              <span className="auth-pill-badge" onClick={() => setAuthModalOpen(true)}>
                👤 {user.username}
              </span>
            ) : (
              <button
                className="topbar-auth-btn"
                onClick={() => { setAuthTab('login'); setAuthModalOpen(true); }}
              >
                Sign In
              </button>
            )}

            <span className={`header-status-indicator indicator-${backendStatus}`}>
              {backendStatus === 'connected' ? '● Online' : backendStatus === 'checking' ? '○ Connecting' : '○ Offline'}
            </span>
          </div>
        </header>

        {/* Chat Window */}
        <div className="chat-window">
          {messages.length === 0 && (
            <div className="empty-state">
              <h2>How can I help you?</h2>
              <p>
                Ask anything about DBMS, Operating Systems, or modern software concepts.
              </p>

              <div className="suggestions">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    className="suggestion-chip"
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`message-group ${msg.type}`}>
              {msg.type === 'bot' && <BotAvatar />}

              <div className="message-content">
                <div className={`bubble ${msg.thinking ? 'thinking-bubble' : ''}`}>
                  {msg.thinking ? (
                    <TypingDots />
                  ) : (
                    <div className={`bubble-text ${msg.type === 'bot' ? 'markdown-content' : 'user-text'}`}>
                      {msg.type === 'bot' ? (
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                      ) : (
                        msg.text
                      )}
                    </div>
                  )}
                </div>

                {!msg.thinking && (
                  <span className="timestamp">
                    {msg.time}
                  </span>
                )}
              </div>

              {msg.type === 'user' && <UserAvatar name={user?.username} />}
            </div>
          ))}

          <div ref={bottomRef} />
        </div>

        {/* Input Area */}
        <div className="input-area">
          <div className="input-bar">
            <input
              ref={inputRef}
              type="text"
              placeholder="Ask a question about your documents or any topic..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />

            <button
              className="send-btn"
              onClick={askQuestion}
              disabled={loading || !input.trim()}
              aria-label="Send message"
            >
              ➤
            </button>
          </div>

          <p className="input-hint">
            Press <kbd>Enter</kbd> to send, <kbd>Shift + Enter</kbd> for new line
          </p>
        </div>
      </div>
    </div>
  );
}