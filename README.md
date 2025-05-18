# 📝 JotDB

**JotDB** is a minimal JSON document store built on [Cloudflare Durable Objects](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/), with runtime schema enforcement and audit logging.

It behaves like a tiny NoSQL database — perfect for structured key-value use cases, without needing a full Firestore or D1 setup.

---

### ✨ Features

- 🔑 Simple `.set(key, value)` / `.get(key)` API
- 🧠 **Optional schema enforcement** via [Zod](https://github.com/colinhacks/zod)
- 🚦 Auto-infers schema from first `.setAll()` call
- ⚠️ Warns on schema diffs (adds, removals, type changes)
- 🧹 Optional stripping of unknown keys
- 🔒 Read-only mode
- 📜 Built-in audit log tracking
- 🪶 Lightweight, RPC-only architecture (no router or HTTP interface)

---

### 🚀 Quick Start

#### Install

```bash
bun install
```

#### Dev

```bash
wrangler dev
```

#### Build

```bash
bun run build
```

#### Test

```bash
bun test jotdb.tests.ts
```

---

### 🧪 API Example

```ts
const jot = env.JOTDB.get(env.JOTDB.idFromName("settings"));

await jot.setAll({ theme: "dark", notifications: true });

await jot.set("language", "en");

const all = await jot.getAll();  // { theme: "dark", notifications: true, language: "en" }

await jot.setOptions({ readOnly: true }); // future writes now fail

const audit = await jot.getAuditLog(); // get change history
```

---

### 📦 Configuration

#### Durable Object Binding

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

---

### 📁 File Structure

```
.
├── src/
│   └── JotDB.ts        # main Durable Object
├── jotdb.tests.ts      # test suite
├── wrangler.jsonc
├── package.json
└── README.md
```

---

### 🧰 Options

```ts
await jot.setOptions({
  autoStrip: true,  // strip keys not in schema
  readOnly: false,  // allow/disallow writes
});
```

---

### 📜 License

MIT
