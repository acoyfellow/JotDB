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
   const db = env.JOTDB.getByName("global");
   ```

2. **Per-User Store**: Create a separate instance for each user
   ```typescript
   const userDb = env.JOTDB.getByName(`user:${userId}`);
   ```

3. **Per-Event Store**: Create temporary stores for events or sessions
   ```typescript
   const eventDb = env.JOTDB.getByName(`event:${eventId}`);
   ```

Each instance is isolated and can have its own schema and options. This follows the Actor Model pattern, where each instance is an independent actor that manages its own state.

## JotDB vs D1

Cloudflare offers D1 (a managed SQLite at the edge). JotDB is not a replacement — it sits in a different niche. Pick deliberately:

| Concern | JotDB | D1 |
|---|---|---|
| Storage model | One blob per Durable Object (`data` key holds the whole object or array) | Relational tables, rows, indexes |
| Query language | Direct method calls: `get`, `set`, `getAll`, `keys`, `has`, `push` | SQL (`SELECT`, `JOIN`, `WHERE`, `ORDER BY`) |
| Indexes | None — `getAll()` returns everything in the DO | B-tree indexes, query planner |
| Schema | Optional, auto-inferred Zod (`string` / `number` / `boolean` / `email` / `array` / `object` / `any`) | Strict DDL, `ALTER TABLE`, types enforced at write |
| Migrations | None — schema changes only emit `console.warn`; existing data is left as-is | Required: managed via `wrangler d1 migrations` |
| Consistency | Strong per-DO (single-writer actor) | Strong per-database; primary/replica replication for reads |
| Locality | The DO lives near its first caller; one hop for all reads/writes against that instance | Database has a primary region; reads can be served from replicas |
| Concurrency | Serialized inside one DO; unlimited DOs in parallel | Many concurrent connections, transactions across rows |
| Hot dataset size | Small — the whole document is rehydrated into memory on access. Practical ceiling: hundreds of KB to a few MB per instance. | Gigabytes per database |
| Cross-entity queries | Not possible — each DO is an island | Trivial — joins are the point |
| Setup cost | `getByName("foo")` | Create database, write migrations, manage schema |
| Best fit | Per-user / per-room / per-tenant documents | Shared, queryable application data |

Rule of thumb: **if the question "give me all rows where X" needs to span instances, you want D1.** If every read/write naturally scopes to one user, one room, one event, one job — JotDB.

## Why not D1?

D1 is excellent. Reach for JotDB instead when:

- **The data is naturally partitioned.** A user's notes, a chat room's messages, a workflow's state — these never need to be joined across partitions. D1 forces you to add a `user_id` column and remember to filter by it on every query. With JotDB, isolation is structural: `env.JOTDB.getByName(\`user:${userId}\`)` cannot accidentally leak across users.
- **You want zero migration overhead.** D1 schema changes require a migration file, deployment, and a backfill plan. JotDB shapes are inferred from the first write and re-inferred whenever you call `setSchema` — adding a new field is just writing it.
- **Latency matters more than queryability.** A Durable Object lives in one location and serves reads from in-memory state after the first hit. There is no SQL parser, no query planner, no network hop to a separate database service.
- **The access pattern is RPC, not query.** If your code already looks like `db.get("settings")` and `db.set("settings", {...})`, putting SQL in front of it is overhead.
- **You need stateful coordination, not just storage.** Because JotDB extends `DurableObject`, you can add your own methods (broadcasts, alarms, websockets) on top of the same actor that owns the data.

Reach for D1 instead when: you need ad-hoc queries, reporting, aggregations, joins across users, full-text search, or anything resembling "show me the top 10 X across the whole system." JotDB cannot do that — it does not have a query engine.

## Starter recipes

### 1. Per-user document store

```typescript
// Each user gets an isolated DO. No `WHERE user_id = ?` to forget.
const userDb = env.JOTDB.getByName(`user:${userId}`);

await userDb.set("profile", { name: "Ada", email: "ada@example.com" });
await userDb.set("preferences", { theme: "dark", density: "compact" });

const profile = await userDb.get("profile");
const everything = await userDb.getAll();
```

### 2. Append-only event log (array mode)

```typescript
// Calling push() puts the DO in array mode and infers the item schema.
const log = env.JOTDB.getByName(`audit:${tenantId}`);

await log.push({ at: Date.now(), actor: "ada", action: "login" });
await log.push({ at: Date.now(), actor: "ada", action: "open-doc", docId: "d1" });

const events = await log.getAll(); // unknown[]
```

Caveat: arrays are stored as a single value. Keep the log bounded (rotate to R2 or another DO when it grows past a few thousand entries).

### 3. Session / ephemeral store

```typescript
const session = env.JOTDB.getByName(`session:${sessionId}`);

await session.setSchema({ userId: "string", csrf: "string", expiresAt: "number" });
await session.setAll({ userId, csrf: crypto.randomUUID(), expiresAt: Date.now() + 3600_000 });

const s = await session.getAll();
```

### 4. Feature flags (read-mostly, validated)

```typescript
const flags = env.JOTDB.getByName("flags:global");

await flags.setSchema({ newCheckout: "boolean", maxUploadMb: "number", betaUsers: "array" });
await flags.setAll({ newCheckout: false, maxUploadMb: 25, betaUsers: ["ada", "linus"] });

// Lock it after deploy:
await flags.setOptions({ readOnly: true });
```

### 5. Form submission collector

```typescript
const responses = env.JOTDB.getByName(`form:${formId}`);

// First push infers the schema from the submission shape.
await responses.push({ email: "ada@example.com", rating: 5, comment: "great" });

// Subsequent pushes are validated against that inferred shape.
await responses.push({ email: "not-an-email", rating: 5, comment: "..." });
// throws: Validation failed: Invalid email
```

### 6. Wrapping for an external HTTP API

```typescript
import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/users/:id", async (c) => {
  const db = c.env.JOTDB.getByName(`user:${c.req.param("id")}`);
  return c.json(await db.getAll());
});

app.put("/users/:id/profile", async (c) => {
  const db = c.env.JOTDB.getByName(`user:${c.req.param("id")}`);
  await db.set("profile", await c.req.json());
  return c.json({ ok: true });
});

export default app;
```

## Migration-less schema evolution

Most databases require a migration step when the shape of your data changes. JotDB doesn't have one — there is no DDL. Here is what actually happens, and where the sharp edges are.

### Adding a field

Use `extendSchema` for additive changes, or replace the full schema with `setSchema`. Auto-inference only happens on a fresh database and should not be relied on for schema evolution.

```typescript
const db = env.JOTDB.getByName("user:42");

// v1
await db.setAll({ name: "Ada", email: "ada@example.com" });

// v2: add `plan` — no migration, no downtime
await db.extendSchema({ plan: "string" });
await db.set("plan", "pro");
```

Existing instances that have not been touched still hold the v1 shape. They are valid until the next write — at which point validation runs against the current in-memory schema for that DO.

### Removing or renaming a field

```typescript
// Old shape contained `nickname`. New writes drop it.
await db.setSchema({ name: "string", email: "email" });
await db.migrate((old) => ({ name: old.name, email: old.email }));
// stored: { name: "Ada", email: "ada@example.com" }
```

JotDB does not currently perform an automatic destructive migration for removed fields. Use `migrate()` when you want to rewrite existing data deliberately.

### Changing a field's type

```typescript
// v1: age was a string ("30")
// v2: age is a number
await db.setSchema({ name: "string", age: "number" });
// console: [JotDB] Type changed for "age": string → number
```

JotDB will log a warning via `console.warn`, but **it does not migrate existing data**. The next write that includes `age` must conform to the new type, or validation throws. If you need to coerce, do it explicitly:

```typescript
const current = (await db.getAll()) as { name: string; age: string };
await db.setAll({ name: current.name, age: Number(current.age) });
```

### Honest caveats

- **There is no global "apply migration" step.** Each DO instance carries its own copy of the schema and its own data. A schema change in one tenant's DO does not propagate to another tenant's DO until that DO is accessed and rewritten.
- **`setSchema` does not validate existing data.** It only affects future writes. Old data that conflicts with the new schema will sit there until it is read and rewritten.
- **Schema inference is shallow.** Nested objects collapse to `"object"` (i.e. `z.record(z.any())`) and arrays-of-arrays collapse to `"array"` (i.e. `z.array(z.any())`). For deep validation, set the schema explicitly and validate at the application boundary.
- **`email` detection during inference is a heuristic** (`includes("@")`). For trustworthy validation, set the schema yourself.

If your data lifecycle requires "all rows must conform to schema vN before deploying code that assumes vN," you want D1 with migrations, not JotDB.

## Honest tradeoffs

JotDB is small on purpose. Things it deliberately does not do:

- **No queries, no indexes, no joins.** `getAll()` returns the entire blob. If you need to filter, do it in your Worker after fetching. If you need to filter across users, you have the wrong tool.
- **The whole document is rehydrated on access.** Each DO loads its `data` key into memory on first call after eviction. Keep the per-instance payload small — think tens to low-hundreds of KB. If you are heading toward megabytes per instance, split into more DOs.
- **One writer per instance.** Durable Objects serialize writes to one instance. That is a feature (no race conditions) and a limit (no parallel writes inside one DO). Shard across DOs by tenant / user / room.
- **Audit log is bounded to 100 entries.** `getAuditLog()` returns the most recent 100 actions per DO. It is intended for debugging and lightweight forensics, not as a system of record.
- **Schema enforcement is best-effort.** Types are limited to `string`, `number`, `boolean`, `email`, `array`, `object`, `any`. There is no `enum`, no `union`, no nested validation. For richer validation, validate with your own Zod schema in the Worker before calling `set`.
- **No transactions across instances.** A write to `user:42` and a write to `user:99` are independent. If you need atomicity across entities, you are modelling the wrong boundary.
- **Cold-start cost.** The first request to an idle DO pays a hydration round-trip to storage. Subsequent requests serve from memory. For latency-sensitive paths, keep DOs warm or accept the first-hit penalty.
- **Cost model is per-DO.** Many small DOs is the intended shape; that means many DO requests and many storage operations. Model your cost against `requests × instances`, not against a single shared database.

If those tradeoffs do not fit your workload, that is a useful signal — either you want D1 (relational, queryable) or you want raw Durable Object storage (no validation layer, more control).

## Benchmarking

JotDB includes a real Durable Object benchmark endpoint for testing the workloads it is designed for:

```bash
curl 'http://localhost:5173/bench?mode=user-prefs&count=100'
curl 'http://localhost:5173/bench?mode=feature-flags&count=1000'
curl 'http://localhost:5173/bench?mode=chat-append&count=100'
curl 'http://localhost:5173/bench?mode=hot-key&count=100'
curl 'http://localhost:5173/bench?mode=multi-instance&count=100'
curl 'http://localhost:5173/bench?mode=cold-warm&count=100'
curl 'http://localhost:5173/bench?mode=schema-validation&count=100'
```

Each benchmark returns real Worker timing data:

```json
{
  "mode": "user-prefs",
  "operations": 100,
  "durationMs": 42.1,
  "opsPerSecond": 2375,
  "p50Ms": 0.31,
  "p95Ms": 0.89,
  "p99Ms": 1.2,
  "errors": 0
}
```

The benchmark modes intentionally map to practical JotDB workloads rather than synthetic key-value loops.

To collect production numbers safely, do not expose the benchmark route on `workers.dev`. This repo sets `workers_dev: false` by default, and the Worker refuses every HTTP request unless `HTTP_ENABLED` is explicitly configured. First claim a personal custom route with a placeholder Worker, put Cloudflare Access in front of it, verify Access from an incognito browser, then deploy the real Worker. Also set a benchmark token:

```bash
wrangler secret put BENCH_TOKEN
wrangler secret put HTTP_ENABLED
npm run deploy
curl -H "Authorization: Bearer $BENCH_TOKEN" 'https://jotdb.<your-personal-domain>/bench?mode=user-prefs&count=100'
curl -H "Authorization: Bearer $BENCH_TOKEN" 'https://jotdb.<your-personal-domain>/bench?mode=feature-flags&count=1000'
curl -H "Authorization: Bearer $BENCH_TOKEN" 'https://jotdb.<your-personal-domain>/bench?mode=chat-append&count=100'
```

The token gate is intentionally checked before any Durable Object access. If you later add Workers AI or other billable bindings, keep the same pattern: Access at the edge plus a code-level token/rate-limit gate before touching the binding.

For a useful README benchmark snapshot, run each mode 5-10 times and report the median result. Keep `count` fixed when comparing local and deployed runs, and avoid claiming one-off best-case numbers. The endpoint is intentionally capped at 1,000 operations per request so benchmark requests do not accidentally become load tests.

The benchmark modes intentionally map to practical JotDB workloads rather than synthetic key-value loops:

- `user-prefs`: repeated updates to one user settings object
- `feature-flags`: repeated reads from a tenant flag object
- `chat-append`: append-only room history
- `hot-key`: many concurrent writes to one Durable Object
- `multi-instance`: one write across many isolated users
- `cold-warm`: first-hit versus repeated access to the same object
- `schema-validation`: repeated Zod-validated writes

## Demo site

A deliberately minimal landing page lives in `demo/index.html`. It is meant to be the simplest possible public-facing demo before a fuller design pass. It currently communicates the core JotDB story:

- one Durable Object per entity
- no SQL or migrations
- schema-validated state
- user preferences
- feature flags
- chat history
- why JotDB is different from D1

Open it locally with any static file server:

```bash
npx serve demo
```

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
    const db = env.JOTDB.getByName("my-db");

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
  autoStrip: boolean;  // Reserved for future explicit strip behavior
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