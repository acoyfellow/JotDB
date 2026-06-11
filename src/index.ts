import { z, ZodTypeAny, ZodObject, ZodError } from "zod";
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
import { DurableObject } from "cloudflare:workers";
import { JotStore, SQLiteStoreAdapter } from './store';

// Type definitions
type SchemaType = "string" | "number" | "boolean" | "email" | "array" | "object" | "any";
interface FieldDescriptor {
  type: SchemaType;
  default?: unknown;
  optional?: boolean;
}
type FieldSpec = SchemaType | FieldDescriptor;
type ObjectSchema = Record<string, FieldSpec>;
type ArraySchema = { __arrayType: SchemaType | ObjectSchema };
type SchemaDefinition = ObjectSchema | ArraySchema;

function isFieldDescriptor(v: FieldSpec): v is FieldDescriptor {
  return typeof v === 'object' && v !== null && 'type' in v;
}
function fieldType(v: FieldSpec): SchemaType {
  return isFieldDescriptor(v) ? v.type : v;
}
function fieldDefault(v: FieldSpec): { has: boolean; value: unknown } {
  if (isFieldDescriptor(v) && 'default' in v) return { has: true, value: v.default };
  return { has: false, value: undefined };
}
function fieldOptional(v: FieldSpec): boolean {
  return isFieldDescriptor(v) && v.optional === true;
}

interface JotDBOptions {
  autoStrip: boolean;
  readOnly: boolean;
}

interface AuditLogEntry {
  timestamp: number;
  action: string;
  keys: string[];
}

function isZodError(e: any): e is ZodError {
  return e && typeof e === 'object' && Array.isArray(e.issues);
}

function handleZod<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (isZodError(e)) {
      throw new Error('Validation failed: ' + e.issues.map(issue => issue.message).join('; '));
    }
    throw e;
  }
}

function isArraySchema(schema: SchemaDefinition): schema is ArraySchema {
  return '__arrayType' in schema;
}
function isObjectSchema(schema: SchemaDefinition): schema is ObjectSchema {
  return !('__arrayType' in schema);
}

function inferPrimitiveType(v: any): SchemaType {
  if (typeof v === "string") return v.includes("@") ? "email" : "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "any";
}

export class JotDB extends DurableObject {
  private data: Record<string, unknown> | unknown[] = {};
  private rawSchema: SchemaDefinition = {};
  private zodSchema: ZodTypeAny | null = null;
  private options: JotDBOptions = {
    autoStrip: false,
    readOnly: false,
  };
  private auditLog: AuditLogEntry[] = [];
  private store: JotStore<unknown> | null = null;

  constructor(state: any, env: Env) {
    super(state, env);
    if (state.storage?.sql) this.store = new JotStore(new SQLiteStoreAdapter(state.storage.sql));
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

  private inferSchemaFromValue(value: any): SchemaDefinition {
    if (Array.isArray(value)) {
      if (value.length === 0) return { __arrayType: "any" };
      const first = value[0];
      if (typeof first === "object" && first !== null && !Array.isArray(first)) {
        // Array of objects
        return { __arrayType: this.inferSchemaFromValue(first) as ObjectSchema };
      }
      // Array of primitives
      return { __arrayType: inferPrimitiveType(first) };
    }
    if (typeof value === "object" && value !== null) {
      const schema: ObjectSchema = {};
      for (const [k, v] of Object.entries(value)) {
        if (Array.isArray(v)) {
          schema[k] = "array";
        } else if (typeof v === "object" && v !== null) {
          schema[k] = "object";
        } else {
          schema[k] = inferPrimitiveType(v);
        }
      }
      return schema;
    }
    // Top-level primitive (shouldn't happen for objects, but fallback)
    return {};
  }

  async push(item: unknown): Promise<void> {
    await this.load();
    if (!Array.isArray(this.data)) {
      this.data = [];
    }
    if (!this.zodSchema) {
      const schema = this.inferSchemaFromValue([item]);
      await this.setSchema(schema);
      console.info('[JotDB] Auto-inferred and set schema from first push:', schema);
    }
    let toPush: unknown = item;
    if (isArraySchema(this.rawSchema)) {
      const at = this.rawSchema.__arrayType;
      if (typeof at === 'object' && at !== null && toPush && typeof toPush === 'object' && !Array.isArray(toPush)) {
        toPush = this.applyDefaultsForObjectSchema(at as ObjectSchema, toPush as Record<string, unknown>);
      }
      toPush = handleZod(() => (this.zodSchema as any).parse([toPush]))[0];
    } else if (this.zodSchema && isObjectSchema(this.rawSchema)) {
      toPush = handleZod(() => this.zodSchema!.parse(toPush));
    }
    (this.data as unknown[]).push(toPush);
    await this.save();
    await this.logAudit("push", []);
  }

  private applyDefaultsForObjectSchema(schema: ObjectSchema, target: Record<string, unknown>): Record<string, unknown> {
    const out = { ...target };
    for (const [key, spec] of Object.entries(schema)) {
      if (out[key] === undefined) {
        const def = fieldDefault(spec);
        if (def.has) out[key] = def.value;
      }
    }
    return out;
  }

  async setAll(objOrArr: Record<string, unknown> | unknown[]): Promise<void> {
    await this.load();
    if (!this.zodSchema) {
      const schema = this.inferSchemaFromValue(objOrArr);
      await this.setSchema(schema);
      console.info('[JotDB] Auto-inferred and set schema from first setAll:', schema);
    }
    if (Array.isArray(objOrArr) && isArraySchema(this.rawSchema)) {
      const at = this.rawSchema.__arrayType;
      if (typeof at === 'object' && at !== null) {
        objOrArr = objOrArr.map(item =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? this.applyDefaultsForObjectSchema(at as ObjectSchema, item as Record<string, unknown>)
            : item
        );
      }
      objOrArr = handleZod(() => (this.zodSchema as any).parse(objOrArr));
    } else if (!Array.isArray(objOrArr) && this.zodSchema && isObjectSchema(this.rawSchema)) {
      objOrArr = this.applyObjectDefaults(objOrArr);
      objOrArr = handleZod(() => this.zodSchema!.parse(objOrArr)) as Record<string, unknown>;
    } else if (Array.isArray(objOrArr) && this.zodSchema && isObjectSchema(this.rawSchema)) {
      objOrArr.forEach(item => handleZod(() => this.zodSchema!.parse(item)));
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
    if (isArraySchema(newSchema) || isArraySchema(current)) return;
    for (const key in newSchema) {
      if (!(key in current)) console.warn(`[JotDB] New key added: ${key}`);
      else {
        const nt = fieldType(newSchema[key]);
        const ct = fieldType((current as ObjectSchema)[key]);
        if (nt !== ct) {
          console.warn(`[JotDB] Type changed for "${key}": ${ct} → ${nt}`);
        }
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

  /**
   * Non-destructively merge additional fields into the current object schema.
   * Useful for additive schema evolution without a full migration.
   * Throws if the current schema is an array schema.
   * New fields with `default` are backfilled into existing stored data.
   * New fields without `default` and without `optional: true` will cause
   * existing stored objects to fail validation on next write — prefer adding
   * `default` or `optional: true` for safe rollouts.
   */
  async extendSchema(partial: ObjectSchema): Promise<void> {
    await this.load();
    if (Object.keys(this.rawSchema).length > 0 && isArraySchema(this.rawSchema)) {
      throw new Error("extendSchema is only supported for object schemas");
    }
    const merged: ObjectSchema = { ...(this.rawSchema as ObjectSchema), ...partial };
    this.warnSchemaDiff(merged);
    this.rawSchema = merged;
    this.zodSchema = this.buildZodSchema(merged);
    await this.ctx.storage.put("__schema__", merged);

    // Backfill defaults into existing stored data, if applicable.
    let mutated = false;
    if (!Array.isArray(this.data)) {
      const next = this.applyObjectDefaults(this.data as Record<string, unknown>);
      if (JSON.stringify(next) !== JSON.stringify(this.data)) {
        this.data = next;
        mutated = true;
      }
    }
    if (mutated) await this.save();
    await this.logAudit("extendSchema", Object.keys(partial));
  }

  /**
   * Validate arbitrary data (or current stored data if omitted) against the
   * current schema without throwing. Returns `{ ok, errors, data }` where
   * `data` is the (possibly default-applied / coerced) parsed result on
   * success. If no schema is set, returns `{ ok: true }`.
   */
  async validate(data?: unknown): Promise<{ ok: boolean; errors?: string[]; data?: unknown }> {
    await this.load();
    if (!this.zodSchema) return { ok: true, data: data ?? this.data };
    const target = data === undefined ? this.data : data;
    try {
      const parsed = this.zodSchema.parse(target);
      return { ok: true, data: parsed };
    } catch (e) {
      if (isZodError(e)) {
        return { ok: false, errors: e.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`) };
      }
      return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
    }
  }

  /**
   * Apply a transform to the stored data. For object mode, `fn` is called once
   * with the entire object and must return the new object. For array mode, `fn`
   * is called once per item and must return the replacement item (return
   * undefined to drop the item).
   * If a schema is set, the resulting data is validated before being saved;
   * on validation failure the original data is left untouched and the function
   * throws. Records an audit entry on success.
   */
  async migrate(fn: (value: any, key?: string | number) => any): Promise<void> {
    await this.load();
    if (this.options.readOnly) throw new Error("Database is in read-only mode");
    let next: Record<string, unknown> | unknown[];
    if (Array.isArray(this.data)) {
      const out: unknown[] = [];
      for (let i = 0; i < this.data.length; i++) {
        const r = fn(this.data[i], i);
        if (r !== undefined) out.push(r);
      }
      next = out;
    } else {
      const r = fn({ ...(this.data as Record<string, unknown>) });
      if (r === null || typeof r !== 'object' || Array.isArray(r)) {
        throw new Error("migrate(fn) for object mode must return a plain object");
      }
      next = r as Record<string, unknown>;
    }
    if (this.zodSchema) {
      try {
        if (Array.isArray(next) && isArraySchema(this.rawSchema)) {
          next = (this.zodSchema as any).parse(next);
        } else if (!Array.isArray(next) && isObjectSchema(this.rawSchema)) {
          next = this.zodSchema.parse(next) as Record<string, unknown>;
        } else if (Array.isArray(next) && isObjectSchema(this.rawSchema)) {
          next.forEach(item => this.zodSchema!.parse(item));
        }
      } catch (e) {
        if (isZodError(e)) {
          throw new Error('migrate validation failed: ' + e.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; '));
        }
        throw e;
      }
    }
    this.data = next;
    await this.save();
    await this.logAudit("migrate", Array.isArray(next) ? [] : Object.keys(next));
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

  private buildZodSchema(schema: SchemaDefinition): ZodTypeAny {
    if (isArraySchema(schema)) {
      const t = schema.__arrayType;
      if (typeof t === "string") {
        switch (t) {
          case "string": return z.string().array();
          case "number": return z.number().array();
          case "boolean": return z.boolean().array();
          case "email": return z.string().email().array();
          default: return z.any().array();
        }
      } else {
        // Array of objects
        return this.buildZodSchema(t).array();
      }
    }
    // Object schema
    const shape: Record<string, ZodTypeAny> = {};
    for (const [key, spec] of Object.entries(schema)) {
      const t = fieldType(spec);
      let zt: ZodTypeAny;
      switch (t) {
        case "string": zt = z.string(); break;
        case "number": zt = z.number(); break;
        case "boolean": zt = z.boolean(); break;
        case "email": zt = z.string().email(); break;
        case "array": zt = z.array(z.any()); break;
        case "object": zt = z.record(z.string(), z.any()); break;
        default: zt = z.any();
      }
      const def = fieldDefault(spec);
      if (def.has) {
        zt = zt.default(def.value as any);
      } else if (fieldOptional(spec)) {
        zt = zt.optional();
      }
      shape[key] = zt;
    }
    return z.object(shape);
  }

  private applyObjectDefaults(target: Record<string, unknown>): Record<string, unknown> {
    if (isArraySchema(this.rawSchema)) return target;
    const out = { ...target };
    for (const [key, spec] of Object.entries(this.rawSchema as ObjectSchema)) {
      if (out[key] === undefined) {
        const def = fieldDefault(spec);
        if (def.has) out[key] = def.value;
      }
    }
    return out;
  }

  async fetch(request: Request) {
    return new Response("Hello, World!");
  }

  async scan<T = unknown>(prefix = '', options?: { limit?: number; cursor?: string }) {
    if (!this.store) throw new Error('SQLite-backed store is not enabled');
    return this.store.scan(prefix, options) as Promise<{ items: T[]; cursor?: string }>;
  }

  async append<T = unknown>(stream: string, value: T) {
    if (!this.store) throw new Error('SQLite-backed store is not enabled');
    return this.store.append(stream, value);
  }

  async appendCapped<T = unknown>(stream: string, value: T, max: number) {
    if (!this.store) throw new Error('SQLite-backed store is not enabled');
    return this.store.appendCapped(stream, value, max);
  }

  async retention(prefix: string, maxAgeMs: number) {
    if (!this.store) throw new Error('SQLite-backed store is not enabled');
    return this.store.retention(prefix, maxAgeMs);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.load();
    if (this.options.readOnly) {
      throw new Error("Database is in read-only mode");
    }
    if (!Array.isArray(this.data)) {
      // Auto-infer schema if not set
      if (!this.zodSchema) {
        const schema = this.inferSchemaFromValue({ [key]: value });
        await this.setSchema(schema);
        console.info('[JotDB] Auto-inferred and set schema from first set:', schema);
      }
      this.data[key] = value;
      if (this.zodSchema) {
        handleZod(() => this.zodSchema!.parse(this.data));
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
  BENCH_TOKEN: string;
  HTTP_ENABLED?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Benchmarks are intentionally gated before any Durable Object access. Set this
// as a Worker secret before exposing a route, or put Cloudflare Access in front
// of the route. This avoids turning benchmark endpoints into public cost sinks.
app.use('/bench', async (c, next) => {
  const token = c.env.BENCH_TOKEN;
  if (!token || c.req.header('Authorization') !== `Bearer ${token}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

// Refuse all HTTP traffic unless an explicit deploy-time gate is configured.
// This keeps local library use working while making accidental public Worker
// deployment fail closed.
app.use('*', async (c, next) => {
  if (!c.env.HTTP_ENABLED) {
    return c.json({ error: 'HTTP surface disabled' }, 403);
  }
  await next();
});

// Middleware
app.use('*', cors());
app.use('*', prettyJSON());

// Test endpoint
app.get('/test', async (c) => {
  const JOB_ID = Date.now().toString();
  const id = c.env.JOTDB.idFromName(JOB_ID);
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
    const arrayId = c.env.JOTDB.idFromName(JOB_ID + "-test-array");
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

    // --- Schema inference tests-- -
    //   Object mode
    const objId = c.env.JOTDB.idFromName("schema-obj");
    const objDb = c.env.JOTDB.get(objId) as unknown as JotDB;
    await objDb.setAll({ foo: "bar", count: 1 });
    const objSchema = await objDb.getSchema();
    let objPassed = false;
    if (!('__arrayType' in objSchema)) {
      objPassed = (objSchema as any).foo === "string" && (objSchema as any).count === "number";
    }
    results.tests.push({
      name: "Object mode: inferred schema",
      passed: objPassed,
      value: objSchema
    });
    let objError = null;
    try {
      await objDb.setAll({ foo: 123, count: "not a number" });
    } catch (e) {
      objError = e instanceof Error ? e.message : String(e);
    }
    results.tests.push({
      name: "Object mode: invalid shape fails",
      passed: !!objError,
      error: objError
    });

    // Array mode
    const arrId = c.env.JOTDB.idFromName("schema-arr");
    const arrDb = c.env.JOTDB.get(arrId) as unknown as JotDB;
    await arrDb.setAll([{ foo: "bar", count: 1 }]);
    const arrSchema = await arrDb.getSchema();
    let arrPassed = false;
    if ('__arrayType' in arrSchema && typeof arrSchema.__arrayType === 'object') {
      const itemSchema = arrSchema.__arrayType as ObjectSchema;
      arrPassed = itemSchema.foo === "string" && itemSchema.count === "number";
    }
    results.tests.push({
      name: "Array mode: inferred schema",
      passed: arrPassed,
      value: arrSchema
    });
    let arrError = null;
    try {
      await arrDb.push({ foo: 123, count: "not a number" });
    } catch (e) {
      arrError = e instanceof Error ? e.message : String(e);
    }
    results.tests.push({
      name: "Array mode: invalid item fails",
      passed: !!arrError,
      error: arrError
    });

    // Test 0: Clear database, set options to read-only: false
    await db.clear();
    results.tests.push({
      name: "Clear database",
      passed: true,
      value: await db.getAll()
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
    console.error(error);
    let errorMessage = error instanceof Error ? error.message : String(error);
    if (isZodError(error)) {
      console.error(error.issues);
      errorMessage = error.issues.map(issue => issue.message).join('\n');
    }
    let html = `<!DOCTYPE html><html><head><title>JotDB Test Error</title></head><body>` +
      `<h1 style="color:red">Error</h1>` +
      `<pre>${errorMessage}</pre>` +
      `<h2>Partial Results</h2>` +
      `<pre>${JSON.stringify(results.tests, null, 2)}</pre>` +
      `<h2>Audit Log</h2>` +
      `<pre>${JSON.stringify(results.auditLog, null, 2)}</pre>` +
      `</body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }
});

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function measure<T>(fn: () => Promise<T>, timings: number[]): Promise<T> {
  const start = performance.now();
  const result = await fn();
  timings.push(performance.now() - start);
  return result;
}

app.get('/bench', async (c) => {
  const mode = c.req.query('mode') ?? 'user-prefs';
  const count = Math.min(Number(c.req.query('count') ?? 100), 1000);
  const timings: number[] = [];
  const started = performance.now();
  let operations = 0;

  if (mode === 'user-prefs') {
    const db = c.env.JOTDB.getByName(`bench:prefs:${Date.now()}`) as unknown as JotDB;
    await db.setSchema({ theme: 'string', notifications: 'boolean', locale: 'string' });
    for (let i = 0; i < count; i++) {
      await measure(() => db.setAll({ theme: i % 2 ? 'dark' : 'light', notifications: true, locale: 'en' }), timings);
      operations++;
    }
  } else if (mode === 'feature-flags') {
    const db = c.env.JOTDB.getByName(`bench:flags:${Date.now()}`) as unknown as JotDB;
    await db.setSchema({ darkMode: 'boolean', betaEditor: 'boolean', aiSearch: 'boolean' });
    await db.setAll({ darkMode: true, betaEditor: false, aiSearch: true });
    for (let i = 0; i < count; i++) { await measure(() => db.getAll(), timings); operations++; }
  } else if (mode === 'chat-append') {
    const db = c.env.JOTDB.getByName(`bench:chat:${Date.now()}`) as unknown as JotDB;
    await db.setAll([]);
    for (let i = 0; i < count; i++) { await measure(() => db.push({ id: i, body: `message ${i}` }), timings); operations++; }
  } else if (mode === 'hot-key') {
    const db = c.env.JOTDB.getByName(`bench:hot:${Date.now()}`) as unknown as JotDB;
    await db.setSchema({ counter: 'number' });
    await db.setAll({ counter: 0 });
    await Promise.all(Array.from({ length: count }, async (_, i) => { await measure(() => db.setAll({ counter: i }), timings); }));
    operations = count;
  } else if (mode === 'multi-instance') {
    await Promise.all(Array.from({ length: count }, async (_, i) => {
      const db = c.env.JOTDB.getByName(`bench:user:${Date.now()}:${i}`) as unknown as JotDB;
      await measure(() => db.set('id', i), timings);
    }));
    operations = count;
  } else if (mode === 'cold-warm') {
    const db = c.env.JOTDB.getByName(`bench:cold:${Date.now()}`) as unknown as JotDB;
    await measure(() => db.set('first', true), timings);
    operations++;
    for (let i = 0; i < count; i++) { await measure(() => db.get('first'), timings); operations++; }
  } else if (mode === 'schema-validation') {
    const db = c.env.JOTDB.getByName(`bench:schema:${Date.now()}`) as unknown as JotDB;
    await db.setSchema({ name: 'string', age: 'number', email: 'email' });
    for (let i = 0; i < count; i++) { await measure(() => db.setAll({ name: `User ${i}`, age: i, email: `u${i}@example.com` }), timings); operations++; }
  } else {
    return c.json({ error: `Unknown benchmark mode: ${mode}` }, 400);
  }

  const durationMs = performance.now() - started;
  return c.json({
    mode,
    operations,
    durationMs,
    opsPerSecond: operations / (durationMs / 1000),
    p50Ms: percentile(timings, 0.5),
    p95Ms: percentile(timings, 0.95),
    p99Ms: percentile(timings, 0.99),
    errors: 0,
  });
});

// Health check endpoint
app.get('/', (c) => c.text('JotDB Durable Object'));

export default app;