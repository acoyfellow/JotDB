import { z, ZodSchema, ZodTypeAny } from 'zod';

// Re-export types from core
export type SchemaType = "string" | "number" | "boolean" | "email" | "array" | "object" | "any";
export type ObjectSchema = Record<string, SchemaType>;
export type ArraySchema = { __arrayType: SchemaType | ObjectSchema };
export type SchemaDefinition = ObjectSchema | ArraySchema;

export interface ChangeEvent {
  type: 'set' | 'delete' | 'clear' | 'push' | 'setAll';
  key?: string;
  value?: unknown;
  timestamp: number;
  instanceId: string;
}

export interface RealtimeMessage {
  type: 'subscribe' | 'unsubscribe' | 'change' | 'subscribed' | 'unsubscribed';
  collection?: string;
  data?: ChangeEvent;
}

export interface JotDBClientConfig {
  endpoint: string;
  schema?: ZodSchema;
  enableRealtime?: boolean;
  autoReconnect?: boolean;
  reconnectDelay?: number;
}

export interface DocumentSnapshot<T = unknown> {
  id: string;
  data: T;
  exists: boolean;
  timestamp: number;
}

export interface QuerySnapshot<T = unknown> {
  docs: DocumentSnapshot<T>[];
  size: number;
  empty: boolean;
}

// Event emitter for handling real-time updates
class EventEmitter {
  private events: Map<string, Set<Function>> = new Map();

  on(event: string, callback: Function): () => void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(callback);
    
    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  off(event: string, callback: Function): void {
    this.events.get(event)?.delete(callback);
  }

  emit(event: string, ...args: unknown[]): void {
    this.events.get(event)?.forEach(callback => {
      try {
        callback(...args);
      } catch (error) {
        console.error('Event handler error:', error);
      }
    });
  }
}

export class Collection<T = unknown> {
  constructor(
    private client: JotDBClient,
    private name: string,
    private schema?: ZodSchema<T>
  ) {}

  // Firestore-like API methods
  async add(data: T): Promise<DocumentSnapshot<T>> {
    const id = crypto.randomUUID();
    return this.doc(id).set(data);
  }

  async get(): Promise<QuerySnapshot<T>> {
    const response = await this.client.request('getAll');
    const rawData = response.data;
    
    if (Array.isArray(rawData)) {
      const docs = rawData.map((item, index) => ({
        id: index.toString(),
        data: this.validateData(item),
        exists: true,
        timestamp: Date.now()
      }));
      
      return {
        docs,
        size: docs.length,
        empty: docs.length === 0
      };
    } else if (rawData && typeof rawData === 'object') {
      const docs = Object.entries(rawData).map(([key, value]) => ({
        id: key,
        data: this.validateData(value),
        exists: true,
        timestamp: Date.now()
      }));
      
      return {
        docs,
        size: docs.length,
        empty: docs.length === 0
      };
    }

    return { docs: [], size: 0, empty: true };
  }

  doc(id: string): DocumentReference<T> {
    return new DocumentReference(this.client, this.name, id, this.schema);
  }

  // Real-time subscription
  onSnapshot(callback: (snapshot: QuerySnapshot<T>) => void): () => void {
    const unsubscribeData = this.client.on('change', async (event: ChangeEvent) => {
      // Refresh data when changes occur
      const snapshot = await this.get();
      callback(snapshot);
    });

    const unsubscribeConnection = this.client.on('connected', async () => {
      // Send initial data when connected
      const snapshot = await this.get();
      callback(snapshot);
    });

    // Subscribe to real-time updates
    this.client.subscribe(this.name);

    return () => {
      unsubscribeData();
      unsubscribeConnection();
      this.client.unsubscribe(this.name);
    };
  }

  private validateData(data: unknown): T {
    if (this.schema) {
      return this.schema.parse(data);
    }
    return data as T;
  }
}

export class DocumentReference<T = unknown> {
  constructor(
    private client: JotDBClient,
    private collection: string,
    private id: string,
    private schema?: ZodSchema<T>
  ) {}

  async get(): Promise<DocumentSnapshot<T>> {
    const response = await this.client.request('get', { key: this.id });
    const data = response.data;
    
    return {
      id: this.id,
      data: this.validateData(data),
      exists: data !== undefined,
      timestamp: Date.now()
    };
  }

  async set(data: T): Promise<DocumentSnapshot<T>> {
    const validatedData = this.validateData(data);
    await this.client.request('set', { key: this.id, value: validatedData });
    
    return {
      id: this.id,
      data: validatedData,
      exists: true,
      timestamp: Date.now()
    };
  }

  async update(data: Partial<T>): Promise<DocumentSnapshot<T>> {
    const current = await this.get();
    if (!current.exists) {
      throw new Error(`Document ${this.id} does not exist`);
    }
    
    const updatedData = { ...current.data, ...data };
    return this.set(updatedData as T);
  }

  async delete(): Promise<void> {
    await this.client.request('delete', { key: this.id });
  }

  onSnapshot(callback: (snapshot: DocumentSnapshot<T>) => void): () => void {
    const unsubscribe = this.client.on('change', async (event: ChangeEvent) => {
      if (event.key === this.id) {
        const snapshot = await this.get();
        callback(snapshot);
      }
    });

    // Send initial data
    this.get().then(callback);

    return unsubscribe;
  }

  private validateData(data: unknown): T {
    if (this.schema) {
      return this.schema.parse(data);
    }
    return data as T;
  }
}

export class JotDBClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private subscriptions = new Set<string>();
  private config: Required<JotDBClientConfig>;

  constructor(config: JotDBClientConfig) {
    super();
    this.config = {
      enableRealtime: true,
      autoReconnect: true,
      reconnectDelay: 1000,
      ...config
    };

    if (this.config.enableRealtime) {
      this.connect();
    }
  }

  collection<T = unknown>(name: string, schema?: ZodSchema<T>): Collection<T> {
    return new Collection(this, name, schema);
  }

  // Internal request method for communicating with Durable Object
  async request(method: string, params?: Record<string, unknown>): Promise<{ data: unknown }> {
    const durableObjectId = this.getDurableObjectId();
    const response = await fetch(`${this.config.endpoint}/do/${durableObjectId}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {})
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`JotDB request failed: ${errorData.error || response.statusText}`);
    }

    return response.json();
  }

  // WebSocket connection management
  private connect(): void {
    if (!this.config.enableRealtime) return;

         try {
       const wsUrl = this.config.endpoint.replace(/^https?/, 'wss');
       const durableObjectId = this.getDurableObjectId();
       this.ws = new WebSocket(`${wsUrl}/ws/${durableObjectId}`);

      this.ws.onopen = () => {
        console.log('[JotDB] Connected to real-time updates');
        this.emit('connected');
        
        // Re-subscribe to collections
        this.subscriptions.forEach(collection => {
          this.sendMessage({ type: 'subscribe', collection });
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message: RealtimeMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('[JotDB] Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('[JotDB] Disconnected from real-time updates');
        this.emit('disconnected');
        
        if (this.config.autoReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[JotDB] WebSocket error:', error);
        this.emit('error', error);
      };
    } catch (error) {
      console.error('[JotDB] Failed to connect:', error);
      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.config.reconnectDelay) as unknown as number;
  }

  private sendMessage(message: RealtimeMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(message: RealtimeMessage): void {
    switch (message.type) {
      case 'change':
        if (message.data) {
          this.emit('change', message.data);
        }
        break;
      case 'subscribed':
        console.log(`[JotDB] Subscribed to ${message.collection}`);
        break;
      case 'unsubscribed':
        console.log(`[JotDB] Unsubscribed from ${message.collection}`);
        break;
    }
  }

  subscribe(collection: string): void {
    this.subscriptions.add(collection);
    this.sendMessage({ type: 'subscribe', collection });
  }

  unsubscribe(collection: string): void {
    this.subscriptions.delete(collection);
    this.sendMessage({ type: 'unsubscribe', collection });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.ws?.close();
    this.ws = null;
  }

  private getDurableObjectId(): string {
    // For now, use a simple approach - in production this would be more sophisticated
    return 'global';
  }
}

// Utility functions for creating clients
export function createClient(config: JotDBClientConfig): JotDBClient {
  return new JotDBClient(config);
}

export function collection<T = unknown>(client: JotDBClient, name: string, schema?: ZodSchema<T>): Collection<T> {
  return client.collection(name, schema);
}

// Export everything needed for the client
export { z } from 'zod';