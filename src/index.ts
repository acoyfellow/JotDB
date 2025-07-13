import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
import { DurableObject } from "cloudflare:workers";
import { v4 as uuidv4 } from 'uuid';

// Environment interface
export interface Env {
  CHATBOT: DurableObjectNamespace;
  DOCUMENTS: R2Bucket;
  VECTOR_INDEX: VectorizeIndex;
  AI: Ai;
}

// Type definitions
interface Document {
  id: string;
  filename: string;
  content: string;
  metadata: Record<string, any>;
  uploadedAt: number;
  chunks: string[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  sources?: string[];
}

interface ChatSession {
  id: string;
  messages: Message[];
  createdAt: number;
  lastActivity: number;
}

// Utility functions
const chunkText = (text: string, chunkSize: number = 1000, overlap: number = 200): string[] => {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
  }
  
  return chunks;
};

const extractTextFromFile = async (file: any): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const extension = file.name.split('.').pop()?.toLowerCase();
  
  switch (extension) {
    case 'txt':
    case 'json':
    case 'md':
      return new TextDecoder().decode(arrayBuffer);
    default:
      return new TextDecoder().decode(arrayBuffer);
  }
};

export class ChatbotDO extends DurableObject {
  private storage: DurableObjectStorage;
  private env: Env;
  private documents: Map<string, Document> = new Map();
  private sessions: Map<string, ChatSession> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.storage = state.storage;
    this.env = env;
  }

  async uploadDocument(file: any, metadata: Record<string, any>): Promise<Document> {
    const id = uuidv4();
    const content = await extractTextFromFile(file);
    const chunks = chunkText(content);
    
    const document: Document = {
      id,
      filename: file.name,
      content,
      metadata,
      uploadedAt: Date.now(),
      chunks
    };

    await this.env.DOCUMENTS.put(id, JSON.stringify(document));
    
    for (const [index, chunk] of chunks.entries()) {
      try {
        const embedding = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', {
          text: chunk
        });
        
        const embeddingData = (embedding as any).data?.[0] || [];
        
        await this.env.VECTOR_INDEX.insert([{
          id: `${id}-${index}`,
          values: embeddingData,
          metadata: {
            documentId: id,
            chunkIndex: index,
            filename: file.name,
            content: chunk
          }
        }]);
      } catch (error) {
        console.error(`Error creating embedding for chunk ${index}:`, error);
      }
    }

    this.documents.set(id, document);
    await this.storage.put(`document:${id}`, document);
    
    return document;
  }

  async getDocument(id: string): Promise<Document | null> {
    const cached = this.documents.get(id);
    if (cached) return cached;
    
    const stored = await this.storage.get<Document>(`document:${id}`);
    if (stored) {
      this.documents.set(id, stored);
      return stored;
    }
    
    return null;
  }

  async searchDocuments(query: string, limit = 10): Promise<Document[]> {
    try {
      const embedding = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: query });
      const embeddingData = (embedding as any).data?.[0] || [];
      
      const results = await this.env.VECTOR_INDEX.query(embeddingData, { topK: limit });
      
      const documentIds = new Set(results.matches.map(m => m.metadata?.documentId).filter(Boolean));
      const documents: Document[] = [];
      
      for (const docId of documentIds) {
        const doc = await this.getDocument(docId);
        if (doc) {
          documents.push(doc);
        }
      }
      
      return documents;
    } catch (error) {
      console.error('Error searching documents:', error);
      return [];
    }
  }

  async deleteDocument(id: string): Promise<void> {
    await this.env.DOCUMENTS.delete(id);
    await this.storage.delete(`document:${id}`);
    this.documents.delete(id);
    
    const doc = await this.storage.get<Document>(`document:${id}`);
    if (doc) {
      try {
        const deleteIds = doc.chunks.map((_, index) => `${id}-${index}`);
        await this.env.VECTOR_INDEX.deleteByIds(deleteIds);
      } catch (error) {
        console.error('Error deleting from vector index:', error);
      }
    }
  }

  async createSession(): Promise<ChatSession> {
    const session: ChatSession = {
      id: uuidv4(),
      messages: [],
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
    
    this.sessions.set(session.id, session);
    await this.storage.put(`session:${session.id}`, session);
    
    return session;
  }

  async getSession(id: string): Promise<ChatSession | null> {
    const cached = this.sessions.get(id);
    if (cached) return cached;
    
    const stored = await this.storage.get<ChatSession>(`session:${id}`);
    if (stored) {
      this.sessions.set(id, stored);
      return stored;
    }
    
    return null;
  }

  async addMessage(sessionId: string, message: Omit<Message, "id" | "timestamp">): Promise<Message> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    
    const newMessage: Message = {
      ...message,
      id: uuidv4(),
      timestamp: Date.now()
    };
    
    session.messages.push(newMessage);
    session.lastActivity = Date.now();
    
    this.sessions.set(sessionId, session);
    await this.storage.put(`session:${sessionId}`, session);
    
    return newMessage;
  }

  async generateResponse(sessionId: string, userMessage: string): Promise<string> {
    try {
      const relevantDocs = await this.searchDocuments(userMessage, 3);
      
      const session = await this.getSession(sessionId);
      if (!session) {
        throw new Error("Session not found");
      }
      
      const recentMessages = session.messages.slice(-5);
      
      const context = relevantDocs.map(doc => 
        `Document: ${doc.filename}\n${doc.content.substring(0, 500)}...`
      ).join('\n\n');
      
      const chatHistory = recentMessages.map(msg => 
        `${msg.role}: ${msg.content}`
      ).join('\n');
      
      const prompt = `You are a helpful assistant. Use the following context to answer questions accurately.

Context from documents:
${context}

Chat history:
${chatHistory}

User: ${userMessage}`;

      const response = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are a helpful assistant that answers questions based on the provided context.' },
          { role: 'user', content: prompt }
        ]
      });

      const responseText = response.response || 'I apologize, but I could not generate a response at this time.';

      const newMessage: Message = {
        id: uuidv4(),
        role: "assistant",
        content: responseText,
        timestamp: Date.now()
      };

      await this.addMessage(sessionId, newMessage);
      return newMessage.content;
    } catch (error) {
      console.error('Error generating response:', error);
      return 'Failed to generate response.';
    }
  }

  async getDocuments(): Promise<Document[]> {
    const documents: Document[] = [];
    
    const allKeys = await this.storage.list();
    
    for (const [key] of allKeys) {
      if (key.startsWith('document:')) {
        const doc = await this.storage.get<Document>(key);
        if (doc) {
          documents.push(doc);
        }
      }
    }
    
    return documents;
  }
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());
app.use('*', prettyJSON());

app.get('/', async (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RAG Chatbot</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; height: 100vh; display: flex; }
        .sidebar { width: 300px; background: #2c3e50; color: white; padding: 20px; overflow-y: auto; }
        .main { flex: 1; display: flex; flex-direction: column; }
        .header { background: #34495e; color: white; padding: 20px; text-align: center; }
        .chat-container { flex: 1; padding: 20px; overflow-y: auto; }
        .input-container { background: white; padding: 20px; border-top: 1px solid #ddd; display: flex; gap: 10px; }
        .input-container input { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
        .input-container button { padding: 10px 20px; background: #3498db; color: white; border: none; border-radius: 5px; cursor: pointer; }
        .input-container button:hover { background: #2980b9; }
        .message { margin-bottom: 20px; padding: 15px; border-radius: 10px; max-width: 80%; }
        .message.user { background: #3498db; color: white; margin-left: auto; }
        .message.assistant { background: white; border: 1px solid #ddd; }
        .upload-area { border: 2px dashed #3498db; border-radius: 5px; padding: 20px; text-align: center; margin-bottom: 20px; cursor: pointer; }
        .upload-area:hover { background: #f8f9fa; }
        .document-item { background: #34495e; margin: 5px 0; padding: 10px; border-radius: 5px; font-size: 14px; }
        .document-item button { background: #e74c3c; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; float: right; }
        .document-item button:hover { background: #c0392b; }
        .loading { text-align: center; color: #7f8c8d; }
        .error { color: #e74c3c; background: #fdf2f2; padding: 10px; border-radius: 5px; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="sidebar">
        <h2>📚 Documents</h2>
        <div class="upload-area" onclick="document.getElementById('fileInput').click()">
            <p>📁 Click to upload documents</p>
            <small>Supports .txt, .md, .json files</small>
        </div>
        <input type="file" id="fileInput" accept=".txt,.md,.json" style="display: none;" multiple>
        <div id="documentList"></div>
    </div>
    
    <div class="main">
        <div class="header">
            <h1>🤖 RAG Chatbot</h1>
            <p>Chat with your documents using AI</p>
        </div>
        
        <div class="chat-container" id="chatContainer">
            <div class="message assistant">
                <p>Hello! I'm your AI assistant. Upload some documents and I'll help you find information from them.</p>
            </div>
        </div>
        
        <div class="input-container">
            <input type="text" id="messageInput" placeholder="Ask me anything about your documents..." />
            <button onclick="sendMessage()">Send</button>
        </div>
    </div>

    <script>
        let currentSessionId = null;
        let documents = [];

        async function initSession() {
            try {
                const response = await fetch('/api/session', { method: 'POST' });
                const session = await response.json();
                currentSessionId = session.id;
            } catch (error) {
                console.error('Failed to initialize session:', error);
            }
        }

        document.getElementById('fileInput').addEventListener('change', async (e) => {
            const files = e.target.files;
            for (const file of files) {
                try {
                    const formData = new FormData();
                    formData.append('file', file);
                    
                    const response = await fetch('/api/document', {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (response.ok) {
                        const document = await response.json();
                        documents.push(document);
                        updateDocumentList();
                        addMessage('system', 'Document "' + document.filename + '" uploaded successfully!');
                    } else {
                        throw new Error('Upload failed');
                    }
                } catch (error) {
                    addMessage('error', 'Failed to upload ' + file.name);
                }
            }
        });

        function updateDocumentList() {
            const list = document.getElementById('documentList');
            list.innerHTML = documents.map(doc => 
                '<div class="document-item">' +
                    doc.filename +
                    '<button onclick="deleteDocument(\\'' + doc.id + '\\')">Delete</button>' +
                '</div>'
            ).join('');
        }

        async function deleteDocument(id) {
            try {
                const response = await fetch('/api/document/' + id, { method: 'DELETE' });
                if (response.ok) {
                    documents = documents.filter(doc => doc.id !== id);
                    updateDocumentList();
                    addMessage('system', 'Document deleted successfully!');
                }
            } catch (error) {
                addMessage('error', 'Failed to delete document');
            }
        }

        async function sendMessage() {
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            
            if (!message || !currentSessionId) return;
            
            addMessage('user', message);
            input.value = '';
            
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'message assistant loading';
            loadingDiv.innerHTML = '<p>🤔 Thinking...</p>';
            document.getElementById('chatContainer').appendChild(loadingDiv);
            
            try {
                const response = await fetch('/api/session/' + currentSessionId + '/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message })
                });
                
                const data = await response.json();
                loadingDiv.remove();
                
                if (response.ok) {
                    addMessage('assistant', data.response);
                } else {
                    addMessage('error', data.error || 'Failed to get response');
                }
            } catch (error) {
                loadingDiv.remove();
                addMessage('error', 'Failed to send message');
            }
        }

        function addMessage(type, content) {
            const container = document.getElementById('chatContainer');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + type;
            messageDiv.innerHTML = '<p>' + content + '</p>';
            container.appendChild(messageDiv);
            container.scrollTop = container.scrollHeight;
        }

        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });

        initSession();
    </script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// API Routes
app.post('/api/session', async (c) => {
  const id = c.env.CHATBOT.idFromName(`session-${Date.now()}`);
  const chatbot = c.env.CHATBOT.get(id);
  
  try {
    const session = await chatbot.createSession();
    return c.json({ id: session.id });
  } catch (error) {
    return c.json({ error: 'Failed to create session' }, 500);
  }
});

app.post('/api/document', async (c) => {
  const id = c.env.CHATBOT.idFromName('default');
  const chatbot = c.env.CHATBOT.get(id);
  
  try {
    const formData = await c.req.formData();
    const file = formData.get('file');
    
    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }
    
    const document = await chatbot.uploadDocument(file, {});
    return c.json(document);
  } catch (error) {
    return c.json({ error: 'Failed to upload document' }, 500);
  }
});

app.delete('/api/document/:id', async (c) => {
  const id = c.env.CHATBOT.idFromName('default');
  const chatbot = c.env.CHATBOT.get(id);
  
  try {
    await chatbot.deleteDocument(c.req.param('id'));
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: 'Failed to delete document' }, 500);
  }
});

app.post('/api/session/:id/chat', async (c) => {
  const sessionId = c.req.param('id');
  const { message } = await c.req.json();
  
  const id = c.env.CHATBOT.idFromName(`session-${sessionId}`);
  const chatbot = c.env.CHATBOT.get(id);
  
  try {
    const response = await chatbot.generateResponse(sessionId, message);
    return c.json({ response });
  } catch (error) {
    return c.json({ error: 'Failed to generate response' }, 500);
  }
});

app.get('/api/documents', async (c) => {
  const id = c.env.CHATBOT.idFromName('default');
  const chatbot = c.env.CHATBOT.get(id);
  
  try {
    const documents = await chatbot.getDocuments();
    return c.json(documents);
  } catch (error) {
    return c.json({ error: 'Failed to fetch documents' }, 500);
  }
});

app.get('/health', (c) => c.text('RAG Chatbot is running'));

export default app;