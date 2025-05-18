# JotDB

## 🚀 Quick Start: Using JotDB in Your Cloudflare Worker

### 1. **Install JotDB**

```bash
bun add jotdb
# or
npm install jotdb
```

### 2. **Bind the Durable Object in your wrangler.toml or wrangler.json**

```toml
[[durable_objects.bindings]]
name = "JOTDB"
class_name = "JotDB"
```

### 3. **Register the Durable Object in your Worker**

```ts
import { JotDB } from 'jotdb';

export interface Env {
  JOTDB: DurableObjectNamespace<JotDB>;
}

export default {
  async fetch(request: Request, env: Env) {
    // Get a stub for your JotDB instance
    const id = env.JOTDB.idFromName("my-db");
    const db = env.JOTDB.get(id);

    // Use RPC (recommended, requires extends DurableObject)
    await db.set("key", "value");
    const value = await db.get("key");

    return new Response(`Value: ${value}`);
  }
};
```

### 4. **Deploy or run locally**

```bash
wrangler dev
# or
wrangler deploy
```

---

## 📝 Notes

- **RPC support:** JotDB uses Cloudflare's new JavaScript-native RPC. You can call methods directly on the stub (e.g., `db.set(...)`, `db.get(...)`).
- **No fetch needed:** You do not need to use HTTP fetch to communicate with your Durable Object—just call methods!
- **TypeScript:** Use `DurableObjectNamespace<JotDB>` for full type safety.
- **See the API section below for all available methods.**

---

## 📚 Full Example

```ts
import { JotDB } from 'jotdb';

export interface Env {
  JOTDB: DurableObjectNamespace<JotDB>;
}

export default {
  async fetch(request: Request, env: Env) {
    const id = env.JOTDB.idFromName("my-db");
    const db = env.JOTDB.get(id);

    await db.setSchema({
      name: "string",
      age: "number",
      email: "email"
    });

    await db.setAll({
      name: "Alice",
      age: 42,
      email: "alice@example.com"
    });

    const all = await db.getAll();

    return new Response(JSON.stringify(all, null, 2), {
      headers: { "Content-Type": "application/json" }
    });
  }
};
```

---

A lightweight, schema-validated key-value store built on Cloudflare Durable Objects.

## Features

- Schema validation using Zod
- Automatic schema inference
- Audit logging
- TypeScript support
- Read-only mode
- Auto-strip mode for schema validation

## Installation

```bash
npm install jotdb
# or
bun add jotdb
```

## Usage

```typescript
import { JotDB } from 'jotdb';

// In your Worker
export interface Env {
  JOTDB: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env) {
    const id = env.JOTDB.idFromName("my-db");
    const db = env.JOTDB.get(id);
    
    // Set a value
    await db.set("key", "value");
    
    // Get a value
    const value = await db.get("key");
    
    // Set schema
    await db.setSchema({
      name: "string",
      age: "number",
      email: "email"
    });
    
    // Set multiple values
    await db.setAll({
      name: "John",
      age: 30,
      email: "john@example.com"
    });
  }
};
```

## API

### Methods

- `get<T>(key: string): Promise<T | undefined>`
- `set<T>(key: string, value: T): Promise<void>`
- `getAll(): Promise<Record<string, unknown>>`
- `setAll(obj: Record<string, unknown>): Promise<void>`
- `delete(key: string): Promise<void>`
- `clear(): Promise<void>`
- `keys(): Promise<string[]>`
- `has(key: string): Promise<boolean>`
- `getSchema(): Promise<SchemaDefinition>`
- `setSchema(schema: SchemaDefinition): Promise<void>`
- `getOptions(): Promise<JotDBOptions>`
- `setOptions(opts: Partial<JotDBOptions>): Promise<void>`
- `getAuditLog(): Promise<AuditLogEntry[]>`
- `clearAuditLog(): Promise<void>`

### Types

```typescript
type SchemaType = "string" | "number" | "boolean" | "email" | "array" | "object" | "any";
type SchemaDefinition = Record<string, SchemaType>;

interface JotDBOptions {
  autoStrip: boolean;
  readOnly: boolean;
}

interface AuditLogEntry {
  timestamp: number;
  action: string;
  keys: string[];
}
```

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Testing

```bash
bun test
```
