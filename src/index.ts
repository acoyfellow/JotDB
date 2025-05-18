import { z, ZodTypeAny, ZodObject } from "zod";
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
import { DurableObject } from "cloudflare:workers";

// Type definitions
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

export class JotDB extends DurableObject {
  private data: Record<string, unknown> | unknown[] = {};
  private rawSchema: SchemaDefinition = {};
  private zodSchema: ZodObject<any> | null = null;
  private options: JotDBOptions = {
    autoStrip: false,
    readOnly: false,
  };
  private auditLog: AuditLogEntry[] = [];

  constructor(state: any, env: Env) {
    super(state, env);
  }

  async load(): Promise<void> {
    if (this.data == null || (typeof this.data === 'object' && Object.keys(this.data).length === 0)) {
      this.data = (await this.ctx.storage.get("data")) ?? {};
    }
    if (Object.keys(this.rawSchema).length === 0) {
      this.rawSchema = (await this.ctx.storage.get("__schema__")) || {};
      if (Object.keys(this.rawSchema).length > 0) {
        this.zodSchema = this.buildZodSchema(this.rawSchema);
      }
    }
    const storedOptions = await this.ctx.storage.get("__options__") as JotDBOptions | null;
    if (storedOptions) this.options = storedOptions;
    this.auditLog = (await this.ctx.storage.get("__audit__")) || [];
  }

  async save(): Promise<void> {
    await this.ctx.storage.put("data", this.data);
  }

  isArrayMode(): boolean {
    return Array.isArray(this.data);
  }

  async push(item: unknown): Promise<void> {
    await this.load();
    if (!Array.isArray(this.data)) {
      this.data = [];
    }
    (this.data as unknown[]).push(item);
    await this.save();
    await this.logAudit("push", []);
  }

  async setAll(objOrArr: Record<string, unknown> | unknown[]): Promise<void> {
    await this.load();
    if (!Array.isArray(objOrArr) && this.zodSchema) {
      objOrArr = this.zodSchema.parse(objOrArr);
    }
    this.data = objOrArr;
    await this.save();
    await this.logAudit("setAll", Array.isArray(objOrArr) ? [] : Object.keys(objOrArr));
  }

  async getAll(): Promise<unknown> {
    await this.load();
    return this.data;
  }

  async logAudit(action: string, keys: string[] | string): Promise<void> {
    const entry: AuditLogEntry = {
      timestamp: Date.now(),
      action,
      keys: Array.isArray(keys) ? keys : [keys],
    };
    this.auditLog.unshift(entry);
    await this.ctx.storage.put("__audit__", this.auditLog.slice(0, 100)); // keep max 100 entries
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    await this.load();
    if (!Array.isArray(this.data)) {
      return this.data[key] as T;
    }
    return undefined;
  }

  async delete(key: string): Promise<void> {
    await this.load();
    if (!Array.isArray(this.data)) {
      delete this.data[key];
      await this.save();
      await this.logAudit("delete", key);
    }
  }

  async clear(): Promise<void> {
    this.data = {};
    await this.save();
    await this.logAudit("clear", []);
  }

  async keys(): Promise<string[]> {
    await this.load();
    if (!Array.isArray(this.data)) {
      return Object.keys(this.data);
    }
    return [];
  }

  async has(key: string): Promise<boolean> {
    await this.load();
    if (!Array.isArray(this.data)) {
      return key in this.data;
    }
    return false;
  }

  async getSchema(): Promise<SchemaDefinition> {
    await this.load();
    return this.rawSchema;
  }

  private warnSchemaDiff(newSchema: SchemaDefinition): void {
    const current = this.rawSchema;
    for (const key in newSchema) {
      if (!(key in current)) console.warn(`[JotDB] New key added: ${key}`);
      else if (newSchema[key] !== current[key]) {
        console.warn(
          `[JotDB] Type changed for "${key}": ${current[key]} → ${newSchema[key]}`
        );
      }
    }
    for (const key in current) {
      if (!(key in newSchema)) {
        console.warn(`[JotDB] Key removed: ${key}`);
      }
    }
  }

  async setSchema(schemaObj: SchemaDefinition): Promise<void> {
    await this.load();
    if (Object.keys(this.rawSchema).length > 0) {
      this.warnSchemaDiff(schemaObj);
    }
    this.rawSchema = schemaObj;
    this.zodSchema = this.buildZodSchema(schemaObj);
    await this.ctx.storage.put("__schema__", schemaObj);
  }

  async setOptions(opts: Partial<JotDBOptions>): Promise<void> {
    await this.load();
    Object.assign(this.options, opts);
    await this.ctx.storage.put("__options__", this.options);
  }

  async getOptions(): Promise<JotDBOptions> {
    await this.load();
    return this.options;
  }

  async getAuditLog(): Promise<AuditLogEntry[]> {
    await this.load();
    return this.auditLog;
  }

  async clearAuditLog(): Promise<void> {
    this.auditLog = [];
    await this.ctx.storage.put("__audit__", []);
  }

  private buildZodSchema(schema: SchemaDefinition): ZodObject<any> {
    const shape: Record<string, ZodTypeAny> = {};
    for (const [key, type] of Object.entries(schema)) {
      switch (type) {
        case "string":
          shape[key] = z.string();
          break;
        case "number":
          shape[key] = z.number();
          break;
        case "boolean":
          shape[key] = z.boolean();
          break;
        case "email":
          shape[key] = z.string().email();
          break;
        case "array":
          shape[key] = z.array(z.any());
          break;
        case "object":
          shape[key] = z.record(z.any());
          break;
        default:
          shape[key] = z.any();
      }
    }
    return z.object(shape);
  }

  async fetch(request: Request) {
    return new Response("Hello, World!");
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.load();
    if (this.options.readOnly) {
      throw new Error("Database is in read-only mode");
    }
    if (!Array.isArray(this.data)) {
      this.data[key] = value;
      if (this.zodSchema) {
        this.zodSchema.parse(this.data);
      }
      await this.save();
      await this.logAudit("set", key);
    } else {
      throw new Error("Cannot use set() in array mode");
    }
  }
}

export interface Env {
  JOTDB: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', cors());
app.use('*', prettyJSON());

// Test endpoint
app.get('/test', async (c) => {
  const id = c.env.JOTDB.idFromName("test-db");
  const db = c.env.JOTDB.get(id) as unknown as JotDB;

  const results = {
    timestamp: Date.now(),
    tests: [] as any[],
    auditLog: [] as any[]
  };

  try {
    // Test 1: Basic set/get
    await db.set("test1", "hello");
    const value1 = await db.get("test1");
    results.tests.push({
      name: "Basic set/get",
      passed: value1 === "hello",
      value: value1
    });

    // Test 2: Schema validation
    await db.setSchema({
      name: "string",
      age: "number",
      email: "email"
    });
    await db.setAll({
      name: "John",
      age: 30,
      email: "john@example.com"
    });
    const all = await db.getAll() as { name: string, age: number, email: string };
    results.tests.push({
      name: "Schema validation",
      passed: all.name === "John" && all.age === 30,
      value: all
    });

    // Test 3: Read-only mode
    await db.setOptions({ readOnly: true });
    try {
      await db.set("test3", "should fail");
      results.tests.push({
        name: "Read-only mode",
        passed: false,
        error: "Should have thrown"
      });
    } catch (e) {
      results.tests.push({
        name: "Read-only mode",
        passed: true,
        error: e instanceof Error ? e.message : String(e)
      });
    }

    // Test 4: Auto-strip mode
    await db.setOptions({ readOnly: false, autoStrip: true });
    await db.setAll({
      name: "Jane",
      age: 25,
      email: "jane@example.com",
      extra: "should be stripped"
    });
    const stripped = await db.getAll() as { name: string, age: number, email: string };
    results.tests.push({
      name: "Auto-strip mode",
      passed: !("extra" in stripped),
      value: stripped
    });

    // Test 5: Array mode - setAll and getAll
    const arrayId = c.env.JOTDB.idFromName("test-array");
    const arrayDb = c.env.JOTDB.get(arrayId) as unknown as JotDB;
    await arrayDb.setAll([1, 2, 3]);
    const arr = await arrayDb.getAll();
    results.tests.push({
      name: "Array mode setAll/getAll",
      passed: Array.isArray(arr) && arr.length === 3 && arr[0] === 1 && arr[2] === 3,
      value: arr
    });

    // Test 6: Array mode - push
    await arrayDb.push(4);
    const arr2 = await arrayDb.getAll();
    results.tests.push({
      name: "Array mode push",
      passed: Array.isArray(arr2) && arr2.length === 4 && arr2[3] === 4,
      value: arr2
    });

    // Get audit log
    results.auditLog = await db.getAuditLog();

    // HTML output
    let html = `<!DOCTYPE html><html><head><title>JotDB Test Results</title>
    <style>
      body { font-family: sans-serif; margin: 2em; }
      .pass { color: green; }
      .fail { color: red; }
      .test { margin-bottom: 1em; }
      pre { background: #f4f4f4; padding: 0.5em; }
    </style>
    </head><body>
    <h1>JotDB Test Results</h1>
    <p><b>Timestamp:</b> ${new Date(results.timestamp).toLocaleString()}</p>
    <div>
      ${results.tests.map(test => `
        <div class="test">
          <b>${test.name}:</b> <span class="${test.passed ? 'pass' : 'fail'}">${test.passed ? 'PASS' : 'FAIL'}</span><br/>
          <pre>${JSON.stringify(test.value ?? test.error, null, 2)}</pre>
        </div>
      `).join('')}
    </div>
    <h2>Audit Log</h2>
    <pre>${JSON.stringify(results.auditLog, null, 2)}</pre>
    </body></html>`;

    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  } catch (error) {
    let html = `<!DOCTYPE html><html><head><title>JotDB Test Error</title></head><body>` +
      `<h1 style="color:red">Error</h1>` +
      `<pre>${error instanceof Error ? error.message : String(error)}</pre>` +
      `<h2>Partial Results</h2>` +
      `<pre>${JSON.stringify(results.tests, null, 2)}</pre>` +
      `<h2>Audit Log</h2>` +
      `<pre>${JSON.stringify(results.auditLog, null, 2)}</pre>` +
      `</body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }
});

// Health check endpoint
app.get('/', (c) => c.text('JotDB Durable Object'));

export default app;