# JotDB

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/jotdb)

A lightweight, schema-less database built on Cloudflare Durable Objects. Think of it as Firestore's security rules, but with Zod validation built-in. Perfect for both internal and external APIs, with automatic type safety and validation.

> **Cloudflare Products**: JotDB works with any Cloudflare product that supports Durable Objects:
> - Cloudflare Workers
> - Cloudflare Pages (with Functions)
> - Cloudflare Workflows
> - Cloudflare Queues
> - Cloudflare Cron Triggers

## Why JotDB?

JotDB combines the best of both worlds: the simplicity of NoSQL with the safety of schema validation. Here's what makes it special:

- **Built-in Type Safety**: Automatic Zod validation ensures your data is always in the right shape
- **Edge-Native**: Runs directly on Cloudflare's edge network, with sub-millisecond latency
- **RPC-First**: Direct method calls instead of HTTP endpoints (though you can easily wrap it in HTTP)
- **Durable Storage**: Built on Durable Objects for reliable, consistent storage
- **Zero Setup**: No database configuration, no connection strings, just instantiate and go
- **Perfect for APIs**: Use it as an internal database or wrap it with auth for external APIs
- **Real-time Ready**: Durable Objects provide strong consistency guarantees

Perfect for:
- Quick prototypes that need data validation
- Small to medium applications that need reliable storage
- Serverless environments where you want type safety
- Real-time data storage with strong consistency
- Collaborative applications that need data validation
- APIs that need both flexibility and safety

## Design Patterns

JotDB uses Cloudflare Durable Objects under the hood, which means you can organize your data in several ways:

1. **Global Store**: Use a single instance for your entire application
   ```typescript
   const db = env.JOTDB.get(env.JOTDB.idFromName("global"));
   ```

2. **Per-User Store**: Create a separate instance for each user
   ```typescript
   const userDb = env.JOTDB.get(env.JOTDB.idFromName(`user:${userId}`));
   ```

3. **Per-Event Store**: Create temporary stores for events or sessions
   ```typescript
   const eventDb = env.JOTDB.get(env.JOTDB.idFromName(`event:${eventId}`));
   ```

Each instance is isolated and can have its own schema and options. This follows the Actor Model pattern, where each instance is an independent actor that manages its own state.

## Installation

```bash
# Using npm
npm install jotdb

# Using yarn
yarn add jotdb

# Using pnpm
pnpm add jotdb
```

### Configure wrangler.jsonc

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "JOTDB",
        "class_name": "JotDB"
      }
    ]
  }
}
```

## Full Example

```typescript
import { JotDB } from 'jotdb';

export interface Env {
  JOTDB: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env) {
    // Initialize the database
    const jotId = env.JOTDB.idFromName("my-db");
    const db = env.JOTDB.get(jotId);

    // Example operations
    await db.set("user:123", { name: "John", age: 30 });
    const user = await db.get("user:123");
    await db.delete("user:123");

    // Return the result
    return new Response(JSON.stringify({ user }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

## API Reference

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `set(key, value)` | Store a value | `key: string`, `value: any` | `Promise<void>` |
| `get(key)` | Retrieve a value | `key: string` | `Promise<any>` |
| `delete(key)` | Remove a value | `key: string` | `Promise<void>` |
| `clear()` | Remove all values | none | `Promise<void>` |
| `keys()` | Get all keys | none | `Promise<string[]>` |
| `has(key)` | Check if key exists | `key: string` | `Promise<boolean>` |
| `getAll()` | Get all data | none | `Promise<Record<string, unknown> \| unknown[]>` |
| `setAll(objOrArr)` | Set all data at once | `objOrArr: Record<string, unknown> \| unknown[]` | `Promise<void>` |
| `push(item)` | Add item to array | `item: unknown` | `Promise<void>` |
| `getSchema()` | Get current schema | none | `Promise<SchemaDefinition>` |
| `setSchema(schema)` | Set data schema | `schema: SchemaDefinition` | `Promise<void>` |
| `getOptions()` | Get current options | none | `Promise<JotDBOptions>` |
| `setOptions(opts)` | Set database options | `opts: Partial<JotDBOptions>` | `Promise<void>` |
| `getAuditLog()` | Get audit log entries | none | `Promise<AuditLogEntry[]>` |
| `clearAuditLog()` | Clear audit log | none | `Promise<void>` |

### Options

```typescript
interface JotDBOptions {
  autoStrip: boolean;  // Automatically strip unknown fields
  readOnly: boolean;   // Enable read-only mode
}
```

### Schema Types

```typescript
type SchemaType = "string" | "number" | "boolean" | "email" | "array" | "object" | "any";
```

## License

MIT License - feel free to use this in your own projects!

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Testing

Currently, testing is done manually in production. We're working on adding a comprehensive test suite. For now, you can test the functionality by:

1. Deploying to Cloudflare Workers
2. Using the example endpoints
3. Verifying data persistence