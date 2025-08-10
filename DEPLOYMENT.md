# JotDB v2 Deployment Guide

This guide walks you through deploying JotDB v2 to Cloudflare and setting up your first real-time application.

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers enabled
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed
- Node.js 18+ and npm

## Step 1: Deploy the Core Database

### 1.1 Clone and Setup
```bash
git clone https://github.com/acoyfellow/jotdb.git
cd jotdb
npm install
```

### 1.2 Configure Cloudflare
```bash
# Login to Cloudflare (if not already)
wrangler login

# Navigate to core package
cd packages/jotdb-core
```

### 1.3 Create KV Namespace (Optional but Recommended)
```bash
# Create production KV namespace
wrangler kv:namespace create "CACHE_KV"

# Create preview KV namespace
wrangler kv:namespace create "CACHE_KV" --preview
```

Copy the returned namespace IDs and update `wrangler.jsonc`:
```jsonc
{
  "kv_namespaces": [
    {
      "binding": "CACHE_KV",
      "id": "your-production-namespace-id",
      "preview_id": "your-preview-namespace-id"
    }
  ]
}
```

### 1.4 Deploy
```bash
# Deploy to Cloudflare
wrangler deploy

# Note the deployed URL - you'll need this for clients
# Example: https://jotdb.your-subdomain.workers.dev
```

## Step 2: Test the Deployment

### 2.1 Test Basic Functionality
```bash
# Test the health endpoint
curl https://your-worker-url.workers.dev/

# Test the legacy API
curl https://your-worker-url.workers.dev/test
```

### 2.2 Test WebSocket Connection
```javascript
// In browser console
const ws = new WebSocket('wss://your-worker-url.workers.dev/ws/global');
ws.onopen = () => console.log('Connected!');
ws.onmessage = (e) => console.log('Message:', e.data);
ws.send(JSON.stringify({ type: 'subscribe', collection: 'test' }));
```

## Step 3: Set Up Your First Client Application

### 3.1 Create a New Project
```bash
# React app
npm create vite@latest my-jotdb-app -- --template react-ts
cd my-jotdb-app

# Or Svelte app
npm create svelte@latest my-jotdb-app
cd my-jotdb-app
```

### 3.2 Install JotDB Client
```bash
# For React
npm install @jotdb/react zod

# For Svelte
npm install @jotdb/svelte zod
```

### 3.3 Initialize Client
Create `src/lib/jotdb.ts`:
```typescript
import { initializeJotDB } from '@jotdb/react'; // or '@jotdb/svelte'

export const jotdb = initializeJotDB({
  endpoint: 'https://your-worker-url.workers.dev',
  enableRealtime: true,
  autoReconnect: true
});
```

### 3.4 Use in Components

**React Example:**
```tsx
import { useCollection, z } from '@jotdb/react';
import './lib/jotdb'; // Initialize client

const TodoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean()
});

function App() {
  const { data: todos, add } = useCollection('todos', TodoSchema);

  return (
    <div>
      <h1>My Todos ({todos.length})</h1>
      {todos.map(todo => (
        <div key={todo.id}>
          {todo.text} {todo.completed ? '✅' : '⏳'}
        </div>
      ))}
      <button onClick={() => add({
        id: crypto.randomUUID(),
        text: 'New todo',
        completed: false
      })}>
        Add Todo
      </button>
    </div>
  );
}
```

**Svelte Example:**
```svelte
<script lang="ts">
  import { useCollection, z } from '@jotdb/svelte';
  import './lib/jotdb'; // Initialize client

  const TodoSchema = z.object({
    id: z.string(),
    text: z.string(),
    completed: z.boolean()
  });

  const todos = useCollection('todos', TodoSchema);

  async function addTodo() {
    await todos.add({
      id: crypto.randomUUID(),
      text: 'New todo',
      completed: false
    });
  }
</script>

<h1>My Todos ({$todos.length})</h1>
{#each $todos as todo}
  <div>{todo.text} {todo.completed ? '✅' : '⏳'}</div>
{/each}
<button on:click={addTodo}>Add Todo</button>
```

## Step 4: Run Example Applications

### 4.1 Todo App (Svelte)
```bash
cd examples/todo-app
npm install
npm run dev
# Open http://localhost:5174
```

### 4.2 Chat App (React)
```bash
cd examples/chat-app
npm install
npm run dev
# Open http://localhost:5175
```

## Step 5: Production Considerations

### 5.1 Environment Configuration
Create different environments for development and production:

**Development:**
```typescript
initializeJotDB({
  endpoint: 'http://localhost:8787', // wrangler dev
  enableRealtime: true
});
```

**Production:**
```typescript
initializeJotDB({
  endpoint: 'https://your-worker.your-subdomain.workers.dev',
  enableRealtime: true
});
```

### 5.2 Security
- Use Cloudflare Access or custom authentication
- Implement rate limiting for WebSocket connections
- Validate all client inputs on the server side

### 5.3 Monitoring
- Enable Cloudflare Analytics
- Monitor Durable Object usage
- Set up alerts for error rates

### 5.4 Scaling
- Use multiple Durable Object instances for different data partitions
- Implement proper error handling and retries
- Consider implementing optimistic updates for better UX

## Troubleshooting

### Common Issues

**1. WebSocket Connection Fails**
- Check that your worker URL is correct
- Ensure WebSocket upgrade headers are properly handled
- Verify CORS settings if connecting from browser

**2. Real-time Updates Not Working**
- Confirm `enableRealtime: true` in client config
- Check browser network tab for WebSocket connection
- Verify Durable Object is broadcasting events

**3. Schema Validation Errors**
- Ensure client and server schemas match
- Check Zod schema definitions
- Verify data types being sent

**4. Performance Issues**
- Enable KV caching for read-heavy workloads
- Consider data partitioning strategies
- Monitor Durable Object CPU usage

### Debug Mode
Enable debug logging in client:
```typescript
initializeJotDB({
  endpoint: 'your-endpoint',
  enableRealtime: true,
  // Add debug logging
});

// Monitor WebSocket events in browser console
```

## Next Steps

1. **Customize your schema** - Define proper Zod schemas for your data
2. **Add authentication** - Integrate with your auth provider
3. **Implement offline support** - Add local storage fallbacks
4. **Monitor performance** - Set up Cloudflare Analytics
5. **Scale as needed** - Partition data across multiple Durable Objects

## Support

- 📖 [Full Documentation](../README.md)
- 💬 [GitHub Discussions](https://github.com/acoyfellow/jotdb/discussions)
- 🐛 [Report Issues](https://github.com/acoyfellow/jotdb/issues)
- 📝 [Examples](../examples/)

---

**Happy building with JotDB v2!** 🚀