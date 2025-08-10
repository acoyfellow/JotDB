# JotDB v2: Real-time Database for Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/jotdb)

A complete **Firestore alternative** built on Cloudflare's edge infrastructure. JotDB v2 combines the simplicity of NoSQL with real-time synchronization, type safety, and edge-native performance.

> **🚀 What's New in v2:**
> - **Real-time WebSocket synchronization** - Live updates across all connected clients
> - **Firestore-like client API** - Familiar `collection().doc().set()` patterns  
> - **Framework adapters** - React hooks, Svelte stores, Vue composables
> - **KV caching layer** - Automatic performance optimization
> - **Local-first sync** - Offline-capable with automatic conflict resolution

## Why JotDB v2?

JotDB v2 is the **complete Firestore alternative for Cloudflare**. While v1 gave you a reliable edge database, v2 adds the real-time client experience that makes Firestore special.

### Core Benefits
- **🔥 Real-time sync** - Changes propagate instantly to all connected clients
- **⚡ Edge-native** - Sub-millisecond latency from Cloudflare's global network
- **🛡️ Type-safe** - End-to-end TypeScript with Zod validation
- **🎯 Zero setup** - No database configuration, just deploy and connect
- **📱 Framework ready** - Drop-in hooks for React, Svelte, Vue
- **💾 Local-first** - Works offline, syncs when reconnected

### Perfect For
- **Collaborative apps** - Real-time editing, live cursors, shared state
- **Live dashboards** - Metrics that update instantly across teams  
- **Chat applications** - Messages sync in real-time
- **Gaming** - Live leaderboards, multiplayer state
- **IoT dashboards** - Sensor data streaming to multiple clients

## Quick Start

### 1. Deploy the Database

```bash
# Clone and deploy to Cloudflare
git clone https://github.com/acoyfellow/jotdb.git
cd jotdb/packages/jotdb-core
npm install
wrangler deploy
```

### 2. Install Client Library

```bash
# For React apps
npm install @jotdb/react zod

# For Svelte apps  
npm install @jotdb/svelte zod

# For Vue apps
npm install @jotdb/vue zod

# Framework-agnostic
npm install @jotdb/client zod
```

### 3. Connect and Use

#### React Example
```tsx
import { initializeJotDB, useCollection } from '@jotdb/react';
import { z } from 'zod';

// Initialize once in your app root
initializeJotDB({
  endpoint: 'https://your-worker.your-subdomain.workers.dev',
  enableRealtime: true
});

// Define your data schema
const TodoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean()
});

function TodoList() {
  const { data: todos, add } = useCollection('todos', TodoSchema);

  return (
    <div>
      {todos.map(todo => (
        <div key={todo.id}>{todo.text}</div>
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

#### Svelte Example
```svelte
<script lang="ts">
  import { initializeJotDB, useCollection } from '@jotdb/svelte';
  import { z } from 'zod';

  // Initialize client
  initializeJotDB({
    endpoint: 'https://your-worker.your-subdomain.workers.dev',
    enableRealtime: true
  });

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

{#each $todos as todo}
  <div>{todo.text}</div>
{/each}

<button on:click={addTodo}>Add Todo</button>
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                          │
├─────────────────────────────────────────────────────────────┤
│  JotDB Durable Object                                       │
│  ├─ Data Storage (Durable Objects Storage)                  │
│  ├─ Real-time WebSockets                                    │
│  ├─ Schema Validation (Zod)                                 │
│  └─ KV Cache Layer                                          │
├─────────────────────────────────────────────────────────────┤
│                   Client Libraries                          │
│  ├─ @jotdb/client (Core)                                    │
│  ├─ @jotdb/react (React Hooks)                              │
│  ├─ @jotdb/svelte (Svelte Stores)                           │
│  └─ @jotdb/vue (Vue Composables)                            │
└─────────────────────────────────────────────────────────────┘
```

## API Reference

### Client Initialization
```typescript
import { initializeJotDB } from '@jotdb/react'; // or svelte, vue

const client = initializeJotDB({
  endpoint: 'https://your-worker.workers.dev',
  enableRealtime: true,      // Enable WebSocket sync
  autoReconnect: true,       // Auto-reconnect on disconnect
  reconnectDelay: 1000       // Reconnect delay in ms
});
```

### Collections (Firestore-like API)
```typescript
// Get a collection reference
const todos = client.collection('todos', TodoSchema);

// Add documents
await todos.add({ text: 'Buy milk', completed: false });

// Get all documents
const snapshot = await todos.get();
snapshot.docs.forEach(doc => console.log(doc.data));

// Real-time subscription
const unsubscribe = todos.onSnapshot(snapshot => {
  console.log('Todos updated:', snapshot.docs.map(d => d.data));
});
```

### Documents
```typescript
// Get document reference
const doc = todos.doc('todo-123');

// Set document data
await doc.set({ text: 'Updated text', completed: true });

// Update partial data
await doc.update({ completed: true });

// Delete document
await doc.delete();

// Real-time subscription
const unsubscribe = doc.onSnapshot(snapshot => {
  if (snapshot.exists) {
    console.log('Document data:', snapshot.data);
  }
});
```

### Framework Hooks

#### React
```typescript
import { useCollection, useDocument, useConnectionStatus } from '@jotdb/react';

function MyComponent() {
  const { data, loading, error, add } = useCollection('todos', TodoSchema);
  const { data: user, set, update } = useDocument('users', 'user-123', UserSchema);
  const { status, isConnected } = useConnectionStatus();
  
  // data automatically updates in real-time
  return <div>{data.map(todo => todo.text)}</div>;
}
```

#### Svelte
```typescript
import { useCollection, useDocument, useConnectionStatus } from '@jotdb/svelte';

const todos = useCollection('todos', TodoSchema);
const user = useDocument('users', 'user-123', UserSchema);
const connectionStatus = useConnectionStatus();

// $todos, $user, $connectionStatus are reactive stores
```

## Examples

This repository includes comprehensive examples:

- **📝 [Todo App](./examples/todo-app)** - Real-time collaborative todo list
- **💬 [Chat App](./examples/chat-app)** - Live messaging with presence
- **📊 [Dashboard](./examples/dashboard)** - Live metrics and analytics

## Deployment

### 1. Core Database (Required)
```bash
cd packages/jotdb-core
wrangler deploy
```

### 2. Configure KV Cache (Optional)
```bash
# Create KV namespace
wrangler kv:namespace create "CACHE_KV"

# Update wrangler.jsonc with the returned ID
```

### 3. Update Client Endpoints
```typescript
initializeJotDB({
  endpoint: 'https://your-deployed-worker.workers.dev',
  enableRealtime: true
});
```

## Migration from v1

JotDB v2 is **100% backward compatible**. Existing v1 code continues to work unchanged.

To enable v2 features:
1. Deploy the enhanced Durable Object
2. Install framework adapters
3. Initialize client with `enableRealtime: true`

```typescript
// v1 code (still works)
const db = env.JOTDB.get(env.JOTDB.idFromName("global"));
await db.set("key", "value");

// v2 real-time features (new)
const client = initializeJotDB({ endpoint: '...', enableRealtime: true });
const todos = useCollection('todos');
```

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| `@jotdb/core` | Enhanced Durable Object with real-time features | 2.0.0 |
| `@jotdb/client` | Framework-agnostic client library | 2.0.0 |
| `@jotdb/react` | React hooks for JotDB | 2.0.0 |
| `@jotdb/svelte` | Svelte stores for JotDB | 2.0.0 |
| `@jotdb/vue` | Vue composables for JotDB | 2.0.0 |

## Contributing

We welcome contributions! This is a monorepo using npm workspaces:

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run examples
cd examples/todo-app && npm run dev
```

## License

MIT License - use this in your own projects!

---

**JotDB v2** - The complete real-time database solution for modern web applications. Built for Cloudflare's edge, designed for developers who want Firestore's experience with edge performance.