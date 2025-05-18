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
  private data: Record<string, unknown> = {};
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
    if (Object.keys(this.data).length === 0) {
      this.data = (await this.ctx.storage.get("data")) || {};
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
    return this.data[key] as T;
  }

  async getAll(): Promise<Record<string, unknown>> {
    await this.load();
    return this.data;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.load();
    if (this.options.readOnly) throw new Error("JotDB is in read-only mode");

    if (this.zodSchema) {
      const partialSchema = this.zodSchema.pick({ [key]: true });
      partialSchema.parse({ [key]: value });
    }
    this.data[key] = value;
    await this.save();
    await this.logAudit("set", key);
  }

  async setAll(obj: Record<string, unknown>): Promise<void> {
    await this.load();
    if (this.options.readOnly) throw new Error("JotDB is in read-only mode");

    const typeOfValue = (v: any): string => {
      if (Array.isArray(v)) return "array";
      switch (typeof v) {
        case "string": return "string";
        case "number": return "number";
        case "boolean": return "boolean";
        case "object": return "object";
        default: return "any";
      }
    };

    if (!this.zodSchema) {
      const inferred: SchemaDefinition = {};
      for (const [k, v] of Object.entries(obj)) {
        inferred[k] = typeOfValue(v) as SchemaType;
      }
      await this.setSchema(inferred);
    }

    if (this.zodSchema) {
      if (this.options.autoStrip) {
        obj = this.zodSchema.parse(obj); // returns stripped
      } else {
        this.zodSchema.parse(obj); // strict match
      }
    }

    Object.assign(this.data, obj);
    await this.save();
    await this.logAudit("setAll", Object.keys(obj));
  }

  async delete(key: string): Promise<void> {
    await this.load();
    delete this.data[key];
    await this.save();
    await this.logAudit("delete", key);
  }

  async clear(): Promise<void> {
    this.data = {};
    await this.save();
    await this.logAudit("clear", []);
  }

  async keys(): Promise<string[]> {
    await this.load();
    return Object.keys(this.data);
  }

  async has(key: string): Promise<boolean> {
    await this.load();
    return key in this.data;
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
    const all = await db.getAll();
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
    const stripped = await db.getAll();
    results.tests.push({
      name: "Auto-strip mode",
      passed: !("extra" in stripped),
      value: stripped
    });

    // Get audit log
    results.auditLog = await db.getAuditLog();

    return c.json(results);
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : String(error),
      tests: results.tests,
      auditLog: results.auditLog
    }, 500);
  }
});

// Health check endpoint
app.get('/', (c) => c.text('JotDB Durable Object'));

export default app;