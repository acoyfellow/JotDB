# Cloudflare RAG Chatbot

A sophisticated end-to-end proof of concept for a **Retrieval-Augmented Generation (RAG)** chatbot built on **Cloudflare Workers** using **TypeScript**, **Effect**, and **Cloudflare AI**.

## ✨ Features

- 📄 **Document Upload**: Upload `.txt`, `.md`, and `.json` files
- 🔍 **Vector Search**: Automatic document embedding and similarity search
- 🤖 **AI Chat**: Smart responses using Cloudflare AI with document context
- 💾 **Persistent Storage**: Documents stored in Cloudflare R2
- 🔄 **Real-time Chat**: WebSocket-like experience with streaming responses
- 🎨 **Modern UI**: Clean, responsive interface with dark sidebar
- ⚡ **Effect-based**: Functional programming patterns with proper error handling

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Interface │    │ Cloudflare      │    │ Durable Object  │
│   (Frontend)    │◄──►│ Worker          │◄──►│ (Chat State)    │
│                 │    │ (Hono API)      │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Cloudflare AI   │
                       │ - Embeddings    │
                       │ - Chat LLM      │
                       └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Storage Layer   │
                       │ - R2 (Docs)     │
                       │ - Vector DB     │
                       │ - DO Storage    │
                       └─────────────────┘
```

## 🛠️ Tech Stack

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Framework**: Hono (Web framework)
- **FP Library**: Effect (Functional programming)
- **AI**: Cloudflare AI (Embeddings + LLM)
- **Storage**: 
  - Cloudflare R2 (Document storage)
  - Cloudflare Vectorize (Vector embeddings)
  - Durable Objects (Chat state)

## 🚀 Getting Started

### Prerequisites

1. **Cloudflare Account** with Workers plan
2. **Node.js** (v18+)
3. **Wrangler CLI** installed globally

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/acoyfellow/cloudflare-rag-chatbot.git
   cd cloudflare-rag-chatbot
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Cloudflare services**:
   
   Create the required Cloudflare resources:
   
   ```bash
   # Create R2 bucket for document storage
   wrangler r2 bucket create chatbot-documents
   
   # Create Vectorize index for embeddings
   wrangler vectorize create document-embeddings --dimensions=384 --metric=cosine
   ```

4. **Deploy the worker**:
   ```bash
   npm run deploy
   ```

### Development

Run the development server:
```bash
npm run dev
```

The chatbot will be available at `http://localhost:5173`

## 📖 Usage

### Web Interface

1. **Access the chatbot** at your worker URL or localhost during development
2. **Upload documents** by clicking the upload area in the sidebar
3. **Start chatting** by typing questions about your documents
4. **View document list** in the sidebar with delete options

### API Endpoints

The chatbot exposes several REST API endpoints:

#### Session Management
- `POST /api/session` - Create a new chat session
- `GET /api/session/:id` - Get session details

#### Document Management
- `POST /api/document` - Upload a document
- `GET /api/documents` - List all documents
- `DELETE /api/document/:id` - Delete a document

#### Chat
- `POST /api/session/:id/chat` - Send a message and get AI response

### Example API Usage

```javascript
// Create a session
const session = await fetch('/api/session', { method: 'POST' });
const { id } = await session.json();

// Upload a document
const formData = new FormData();
formData.append('file', fileInput.files[0]);
await fetch('/api/document', { method: 'POST', body: formData });

// Chat with your documents
const response = await fetch(`/api/session/${id}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'What is this document about?' })
});
const { response: answer } = await response.json();
```

## 🔧 Configuration

### Environment Variables

Configure in `wrangler.toml`:

```toml
[vars]
# Add any environment variables here
```

### Cloudflare Services

The app requires these Cloudflare services (configured in `wrangler.jsonc`):

- **R2 Bucket**: `chatbot-documents`
- **Vectorize Index**: `document-embeddings`
- **AI Binding**: Default AI binding
- **Durable Objects**: `ChatbotDO`

## 🧠 How RAG Works

1. **Document Processing**:
   - Upload documents via web interface
   - Extract text content from files
   - Split into chunks (1000 chars with 200 overlap)
   - Generate embeddings using `@cf/baai/bge-base-en-v1.5`
   - Store in Vectorize index

2. **Query Processing**:
   - User asks a question
   - Generate embedding for the question
   - Search for similar document chunks
   - Retrieve top 3 most relevant chunks

3. **Response Generation**:
   - Combine retrieved chunks with chat history
   - Create structured prompt for LLM
   - Generate response using `@cf/meta/llama-3-8b-instruct`
   - Return contextual answer

## 🎯 Effect Usage

This project demonstrates **Effect** patterns for:

- **Service Definition**: Context-based service architecture
- **Error Handling**: Proper error boundaries and propagation
- **Async Operations**: Effect-based async with proper typing
- **Functional Composition**: Pure functions with side effects

Example Effect service:

```typescript
class DocumentService extends Context.Tag("DocumentService")<
  DocumentService,
  {
    uploadDocument: (file: File, metadata: Record<string, unknown>) => Effect.Effect<Document, Error>;
    getDocument: (id: string) => Effect.Effect<Option.Option<Document>, Error>;
    searchDocuments: (query: string, limit?: number) => Effect.Effect<Document[], Error>;
    deleteDocument: (id: string) => Effect.Effect<void, Error>;
  }
>() {}
```

## 🔒 Security Considerations

- **Input Validation**: All inputs validated using Effect Schema
- **Error Handling**: Comprehensive error boundaries
- **Access Control**: Session-based access (extend for auth)
- **Rate Limiting**: Add rate limiting for production use

## 🚀 Deployment

### Production Deployment

1. **Set up secrets**:
   ```bash
   wrangler secret put API_KEY
   ```

2. **Deploy**:
   ```bash
   npm run deploy
   ```

3. **Custom Domain** (optional):
   ```bash
   wrangler publish --routes="chatbot.yourdomain.com/*"
   ```

## 📊 Performance

- **Cold Start**: ~50ms with Cloudflare Workers
- **Document Processing**: ~2s per document (depends on size)
- **Chat Response**: ~1-3s (depends on context size)
- **Concurrent Users**: Scales automatically with Cloudflare

## 🛣️ Roadmap

- [ ] **Authentication**: User login and session management
- [ ] **Advanced RAG**: Multi-modal support (images, PDFs)
- [ ] **Streaming**: Real-time response streaming
- [ ] **Analytics**: Usage tracking and insights
- [ ] **Webhooks**: Integration with external services
- [ ] **Mobile App**: React Native companion app

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Cloudflare** for the amazing Workers platform
- **Effect** team for the functional programming library
- **Hono** for the lightweight web framework
- **Community** for inspiration and feedback

---

**Built with ❤️ using Cloudflare Workers, TypeScript, and Effect**