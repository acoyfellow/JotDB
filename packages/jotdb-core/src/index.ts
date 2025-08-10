import { z, ZodTypeAny, ZodObject, ZodError } from "zod";
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
import { DurableObject } from "cloudflare:workers";

// Type definitions
type SchemaType = "string" | "number" | "boolean" | "email" | "array" | "object" | "any";
type ObjectSchema = Record<string, SchemaType>;
type ArraySchema = { __arrayType: SchemaType | ObjectSchema };
type SchemaDefinition = ObjectSchema | ArraySchema;

interface JotDBOptions {
  autoStrip: boolean;
  readOnly: boolean;
  enableRealtime: boolean; // NEW: Enable real-time features
}

interface AuditLogEntry {
  timestamp: number;
  action: string;
  keys: string[];
}

// NEW: Real-time event types
interface ChangeEvent {
  type: 'set' | 'delete' | 'clear' | 'push' | 'setAll';
  key?: string;
  value?: unknown;
  timestamp: number;
  instanceId: string;
}

interface RealtimeMessage {
  type: 'subscribe' | 'unsubscribe' | 'change';
  collection?: string;
  data?: ChangeEvent;
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
    enableRealtime: false,
  };
  private auditLog: AuditLogEntry[] = [];
  
  // NEW: Real-time WebSocket management
  private connections = new Set<WebSocket>();
  private instanceId: string;
  private env: Env;

  constructor(state: any, env: Env) {
    super(state, env);
    this.instanceId = crypto.randomUUID();
    this.env = env;
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
        return { __arrayType: this.inferSchemaFromValue(first) };
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
    if (isArraySchema(this.rawSchema)) {
      handleZod(() => (this.zodSchema as any).parse([item]));
    } else if (this.zodSchema && isObjectSchema(this.rawSchema)) {
      handleZod(() => this.zodSchema!.parse(item));
    }
    (this.data as unknown[]).push(item);
    await this.save();
    await this.logAudit("push", []);
    
    // NEW: Broadcast change event
    this.broadcast({
      type: 'push',
      value: item,
      timestamp: Date.now(),
      instanceId: this.instanceId
    });
  }

  async setAll(objOrArr: Record<string, unknown> | unknown[]): Promise<void> {
    await this.load();
    if (!this.zodSchema) {
      const schema = this.inferSchemaFromValue(objOrArr);
      await this.setSchema(schema);
      console.info('[JotDB] Auto-inferred and set schema from first setAll:', schema);
    }
    if (Array.isArray(objOrArr) && isArraySchema(this.rawSchema)) {
      handleZod(() => (this.zodSchema as any).parse(objOrArr));
    } else if (!Array.isArray(objOrArr) && this.zodSchema && isObjectSchema(this.rawSchema)) {
      objOrArr = handleZod(() => this.zodSchema!.parse(objOrArr));
    } else if (Array.isArray(objOrArr) && this.zodSchema && isObjectSchema(this.rawSchema)) {
      objOrArr.forEach(item => handleZod(() => this.zodSchema!.parse(item)));
    }
    this.data = objOrArr;
    await this.save();
    await this.logAudit("setAll", Array.isArray(objOrArr) ? [] : Object.keys(objOrArr));
    
    // NEW: Broadcast change event
    this.broadcast({
      type: 'setAll',
      value: objOrArr,
      timestamp: Date.now(),
      instanceId: this.instanceId
    });
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
      
      // NEW: Invalidate cache
      await this.invalidateCache(key);
      
      // NEW: Broadcast change event
      this.broadcast({
        type: 'delete',
        key,
        timestamp: Date.now(),
        instanceId: this.instanceId
      });
    }
  }

  async clear(): Promise<void> {
    this.data = {};
    await this.save();
    await this.logAudit("clear", []);
    
    // NEW: Invalidate all cache
    await this.invalidateCache();
    
    // NEW: Broadcast change event
    this.broadcast({
      type: 'clear',
      timestamp: Date.now(),
      instanceId: this.instanceId
    });
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
    for (const [key, type] of Object.entries(schema)) {
      switch (type) {
        case "string": shape[key] = z.string(); break;
        case "number": shape[key] = z.number(); break;
        case "boolean": shape[key] = z.boolean(); break;
        case "email": shape[key] = z.string().email(); break;
        case "array": shape[key] = z.array(z.any()); break;
        case "object": shape[key] = z.record(z.any()); break;
        default: shape[key] = z.any();
      }
    }
    return z.object(shape);
  }

  // NEW: Real-time broadcasting
  private broadcast(event: ChangeEvent): void {
    if (!this.options.enableRealtime) return;
    
    const message: RealtimeMessage = {
      type: 'change',
      data: event
    };
    
    this.connections.forEach(ws => {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        // Remove broken connections
        this.connections.delete(ws);
      }
    });
  }

  // NEW: WebSocket upgrade handling
  async fetch(request: Request) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      return this.handleWebSocket(request);
    }
    
    return new Response("JotDB Durable Object - Use WebSocket for real-time features");
  }

  // NEW: WebSocket connection handler
  private async handleWebSocket(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();
    this.connections.add(server);

    server.addEventListener('message', (event) => {
      try {
        const message: RealtimeMessage = JSON.parse(event.data as string);
        this.handleWebSocketMessage(server, message);
      } catch (error) {
        server.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    server.addEventListener('close', () => {
      this.connections.delete(server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // NEW: Handle WebSocket messages
  private handleWebSocketMessage(ws: WebSocket, message: RealtimeMessage): void {
    switch (message.type) {
      case 'subscribe':
        // For now, just acknowledge subscription
        ws.send(JSON.stringify({ type: 'subscribed', collection: message.collection }));
        break;
      case 'unsubscribe':
        // Handle unsubscription if needed
        ws.send(JSON.stringify({ type: 'unsubscribed', collection: message.collection }));
        break;
    }
  }

  // NEW: KV cache integration
  private async updateCache(key: string, data: unknown): Promise<void> {
    if (!this.env.CACHE_KV) return;
    
    try {
      const cacheKey = `jotdb:${this.instanceId}:${key}`;
      await this.env.CACHE_KV.put(cacheKey, JSON.stringify(data), {
        expirationTtl: 3600 // 1 hour cache
      });
    } catch (error) {
      console.warn('[JotDB] Cache update failed:', error);
    }
  }

  private async getFromCache(key: string): Promise<unknown | null> {
    if (!this.env.CACHE_KV) return null;
    
    try {
      const cacheKey = `jotdb:${this.instanceId}:${key}`;
      const cached = await this.env.CACHE_KV.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.warn('[JotDB] Cache read failed:', error);
      return null;
    }
  }

  private async invalidateCache(key?: string): Promise<void> {
    if (!this.env.CACHE_KV) return;
    
    try {
      if (key) {
        const cacheKey = `jotdb:${this.instanceId}:${key}`;
        await this.env.CACHE_KV.delete(cacheKey);
      } else {
        // Clear all cache for this instance (would need to track keys)
        // For now, we'll rely on TTL expiration
      }
    } catch (error) {
      console.warn('[JotDB] Cache invalidation failed:', error);
    }
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
      
      // NEW: Update cache
      await this.updateCache(key, value);
      
      // NEW: Broadcast change event
      this.broadcast({
        type: 'set',
        key,
        value,
        timestamp: Date.now(),
        instanceId: this.instanceId
      });
    } else {
      throw new Error("Cannot use set() in array mode");
    }
  }
}

export interface Env {
  JOTDB: DurableObjectNamespace;
  CACHE_KV?: KVNamespace; // NEW: Optional KV cache for performance
}

const app = new Hono<{ Bindings: Env }>();

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
      arrPassed = arrSchema.__arrayType.foo === "string" && arrSchema.__arrayType.count === "number";
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

// API endpoints for client communication
app.post('/do/:id/:method', async (c) => {
  const { id, method } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  
  const durableObjectId = c.env.JOTDB.idFromName(id);
  const db = c.env.JOTDB.get(durableObjectId) as unknown as JotDB;

  try {
    let result;
    switch (method) {
      case 'get':
        result = await db.get(body.key);
        break;
      case 'set':
        await db.set(body.key, body.value);
        result = { success: true };
        break;
      case 'delete':
        await db.delete(body.key);
        result = { success: true };
        break;
      case 'clear':
        await db.clear();
        result = { success: true };
        break;
      case 'getAll':
        result = await db.getAll();
        break;
      case 'setAll':
        await db.setAll(body.value);
        result = { success: true };
        break;
      case 'push':
        await db.push(body.value);
        result = { success: true };
        break;
      case 'keys':
        result = await db.keys();
        break;
      case 'has':
        result = await db.has(body.key);
        break;
      case 'getSchema':
        result = await db.getSchema();
        break;
      case 'setSchema':
        await db.setSchema(body.schema);
        result = { success: true };
        break;
      case 'getOptions':
        result = await db.getOptions();
        break;
      case 'setOptions':
        await db.setOptions(body.options);
        result = { success: true };
        break;
      default:
        return c.json({ error: 'Unknown method' }, 400);
    }

    return c.json({ data: result });
  } catch (error) {
    console.error('JotDB API error:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// WebSocket endpoint for real-time connections
app.get('/ws/:id', async (c) => {
  const { id } = c.req.param();
  const upgradeHeader = c.req.header('upgrade');
  
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 400);
  }

  const durableObjectId = c.env.JOTDB.idFromName(id);
  const db = c.env.JOTDB.get(durableObjectId);
  
  return db.fetch(c.req.raw);
});

// Health check endpoint
app.get('/', (c) => c.text('JotDB v2 - Real-time Database'));

export default app;