import React, { useState, useEffect, useRef } from 'react';
import { initializeJotDB, useCollection, useConnectionStatus, z } from '@jotdb/react';
import './App.css';

// Initialize JotDB client
initializeJotDB({
  endpoint: 'https://your-jotdb-worker.your-subdomain.workers.dev',
  enableRealtime: true
});

// Message schema
const MessageSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  author: z.string(),
  timestamp: z.number(),
  edited: z.boolean().default(false)
});

// User presence schema
const PresenceSchema = z.object({
  userId: z.string(),
  username: z.string(),
  lastSeen: z.number(),
  isTyping: z.boolean().default(false)
});

type Message = z.infer<typeof MessageSchema>;
type UserPresence = z.infer<typeof PresenceSchema>;

function App() {
  const [username, setUsername] = useState('');
  const [currentMessage, setCurrentMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [userId] = useState(() => crypto.randomUUID());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<number>();

  // Real-time collections
  const { data: messages, add: addMessage } = useCollection<Message>('messages', MessageSchema);
  const { data: presenceList } = useCollection<UserPresence>('presence', PresenceSchema);
  const { status, isConnected } = useConnectionStatus();

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Update user presence
  useEffect(() => {
    if (!username) return;

    const updatePresence = async () => {
      const client = (window as any).jotdbClient;
      const presenceCollection = client.collection('presence', PresenceSchema);
      
      await presenceCollection.doc(userId).set({
        userId,
        username,
        lastSeen: Date.now(),
        isTyping
      });
    };

    updatePresence();

    // Update presence every 30 seconds
    const interval = setInterval(updatePresence, 30000);
    return () => clearInterval(interval);
  }, [username, userId, isTyping]);

  // Handle typing indicators
  useEffect(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    if (currentMessage && !isTyping) {
      setIsTyping(true);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 2000) as unknown as number;

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [currentMessage]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentMessage.trim() || !username) return;

    const message: Message = {
      id: crypto.randomUUID(),
      text: currentMessage.trim(),
      author: username,
      timestamp: Date.now(),
      edited: false
    };

    await addMessage(message);
    setCurrentMessage('');
    setIsTyping(false);
  };

  const handleUsernameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      // Username is set, will trigger presence update
    }
  };

  // Filter out current user and old presence
  const activeUsers = presenceList
    .filter(p => p.userId !== userId && Date.now() - p.lastSeen < 60000)
    .filter(p => p.username !== username);

  const typingUsers = activeUsers.filter(p => p.isTyping);

  if (!username) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1>JotDB Chat</h1>
          <p>Real-time chat powered by JotDB v2</p>
          <form onSubmit={handleUsernameSubmit}>
            <input
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="username-input"
              autoFocus
            />
            <button type="submit" disabled={!username.trim()}>
              Join Chat
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>JotDB Chat</h1>
        <div className="connection-status">
          <div className={`status-indicator ${status}`}></div>
          <span>{status}</span>
        </div>
        <div className="user-info">
          Welcome, <strong>{username}</strong>
        </div>
      </header>

      <div className="chat-sidebar">
        <h3>Online Users ({activeUsers.length + 1})</h3>
        <div className="user-list">
          <div className="user current-user">
            {username} (you)
          </div>
          {activeUsers.map(user => (
            <div key={user.userId} className="user">
              {user.username}
              {user.isTyping && <span className="typing-indicator">typing...</span>}
            </div>
          ))}
        </div>
      </div>

      <main className="chat-main">
        <div className="messages-container">
          {messages.map(message => (
            <div key={message.id} className={`message ${message.author === username ? 'own' : ''}`}>
              <div className="message-header">
                <span className="author">{message.author}</span>
                <span className="timestamp">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="message-text">{message.text}</div>
            </div>
          ))}
          
          {typingUsers.length > 0 && (
            <div className="typing-indicator-container">
              <div className="typing-indicator">
                {typingUsers.map(u => u.username).join(', ')} 
                {typingUsers.length === 1 ? ' is' : ' are'} typing...
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSendMessage} className="message-form">
          <input
            type="text"
            placeholder="Type a message..."
            value={currentMessage}
            onChange={(e) => setCurrentMessage(e.target.value)}
            className="message-input"
            disabled={!isConnected}
          />
          <button 
            type="submit" 
            disabled={!currentMessage.trim() || !isConnected}
            className="send-button"
          >
            Send
          </button>
        </form>
      </main>
    </div>
  );
}

export default App;