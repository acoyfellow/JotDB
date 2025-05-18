import { z, ZodTypeAny, ZodObject } from "zod";
import { DurableObjectState } from "@cloudflare/workers-types";

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

export class JotDB {
  private state: DurableObjectState;
  private data: Record<string, unknown> = {};
  private rawSchema: SchemaDefinition = {};
  private zodSchema: ZodObject<any> | null = null;
  private options: JotDBOptions = {
    autoStrip: false,
    readOnly: false,
  };
  private auditLog: AuditLogEntry[] = [];

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async load(): Promise<void> {
    if (Object.keys(this.data).length === 0) {
      this.data = (await this.state.storage.get("data")) || {};
    }
    if (Object.keys(this.rawSchema).length === 0) {
      this.rawSchema = (await this.state.storage.get("__schema__")) || {};
      if (Object.keys(this.rawSchema).length > 0) {
        this.zodSchema = this.buildZodSchema(this.rawSchema);
      }
    }
    const storedOptions = await this.state.storage.get("__options__") as JotDBOptions | null;
    if (storedOptions) this.options = storedOptions;

    this.auditLog = (await this.state.storage.get("__audit__")) || [];
  }

  async save(): Promise<void> {
    await this.state.storage.put("data", this.data);
  }

  async logAudit(action: string, keys: string[] | string): Promise<void> {
    const entry: AuditLogEntry = {
      timestamp: Date.now(),
      action,
      keys: Array.isArray(keys) ? keys : [keys],
    };
    this.auditLog.unshift(entry);
    await this.state.storage.put("__audit__", this.auditLog.slice(0, 100)); // keep max 100 entries
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

    if (!this.zodSchema) {
      const inferred: SchemaDefinition = {};
      for (const [k, v] of Object.entries(obj)) {
        inferred[k] =
          typeof v === "string"
            ? "string"
            : typeof v === "number"
              ? "number"
              : typeof v === "boolean"
                ? "boolean"
                : Array.isArray(v)
                  ? "array"
                  : typeof v === "object"
                    ? "object"
                    : "any";
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
    await this.state.storage.put("__schema__", schemaObj);
  }

  async setOptions(opts: Partial<JotDBOptions>): Promise<void> {
    await this.load();
    Object.assign(this.options, opts);
    await this.state.storage.put("__options__", this.options);
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
    await this.state.storage.put("__audit__", []);
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
}


export default {
  async fetch(request: Request, env: { JOTDB: DurableObjectNamespace }, ctx: ExecutionContext): Promise<Response> {
    // This is just a stub to satisfy the module worker requirement
    // The actual functionality is in the JotDB class
    return new Response("JotDB Durable Object", { status: 200 });
  }
};