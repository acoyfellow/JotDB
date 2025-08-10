import { writable, readable, type Readable, type Writable } from 'svelte/store';
import { 
  JotDBClient, 
  Collection, 
  DocumentReference,
  DocumentSnapshot,
  QuerySnapshot,
  type JotDBClientConfig,
  type ZodSchema
} from '@jotdb/client';

// Svelte-specific store types
export interface CollectionStore<T> extends Readable<T[]> {
  add: (data: T) => Promise<DocumentSnapshot<T>>;
  refresh: () => Promise<void>;
}

export interface DocumentStore<T> extends Readable<T | null> {
  set: (data: T) => Promise<DocumentSnapshot<T>>;
  update: (data: Partial<T>) => Promise<DocumentSnapshot<T>>;
  delete: () => Promise<void>;
  refresh: () => Promise<void>;
}

// Global client instance
let globalClient: JotDBClient | null = null;

export function initializeJotDB(config: JotDBClientConfig): JotDBClient {
  globalClient = new JotDBClient(config);
  return globalClient;
}

export function getJotDBClient(): JotDBClient {
  if (!globalClient) {
    throw new Error('JotDB client not initialized. Call initializeJotDB() first.');
  }
  return globalClient;
}

export function useCollection<T = unknown>(
  name: string, 
  schema?: ZodSchema<T>
): CollectionStore<T> {
  const client = getJotDBClient();
  const collection = client.collection(name, schema);
  
  const { subscribe, set } = writable<T[]>([]);
  let unsubscribe: (() => void) | null = null;
  let isSubscribed = false;

  const store: CollectionStore<T> = {
    subscribe: (run, invalidate) => {
      // Set up real-time subscription on first subscriber
      if (!isSubscribed) {
        isSubscribed = true;
        unsubscribe = collection.onSnapshot((snapshot: QuerySnapshot<T>) => {
          set(snapshot.docs.map(doc => doc.data));
        });
      }

      const unsubscribeStore = subscribe(run, invalidate);
      
      // Clean up when no more subscribers
      return () => {
        unsubscribeStore();
        // Note: We keep the real-time subscription active for simplicity
        // In a production version, you might want to track subscriber count
      };
    },

    add: async (data: T) => {
      return collection.add(data);
    },

    refresh: async () => {
      const snapshot = await collection.get();
      set(snapshot.docs.map(doc => doc.data));
    }
  };

  return store;
}

export function useDocument<T = unknown>(
  collectionName: string,
  documentId: string,
  schema?: ZodSchema<T>
): DocumentStore<T> {
  const client = getJotDBClient();
  const collection = client.collection(collectionName, schema);
  const doc = collection.doc(documentId);
  
  const { subscribe, set } = writable<T | null>(null);
  let unsubscribe: (() => void) | null = null;
  let isSubscribed = false;

  const store: DocumentStore<T> = {
    subscribe: (run, invalidate) => {
      // Set up real-time subscription on first subscriber
      if (!isSubscribed) {
        isSubscribed = true;
        unsubscribe = doc.onSnapshot((snapshot: DocumentSnapshot<T>) => {
          set(snapshot.exists ? snapshot.data : null);
        });
      }

      const unsubscribeStore = subscribe(run, invalidate);
      
      return () => {
        unsubscribeStore();
        // Note: We keep the real-time subscription active for simplicity
      };
    },

    set: async (data: T) => {
      return doc.set(data);
    },

    update: async (data: Partial<T>) => {
      return doc.update(data);
    },

    delete: async () => {
      await doc.delete();
    },

    refresh: async () => {
      const snapshot = await doc.get();
      set(snapshot.exists ? snapshot.data : null);
    }
  };

  return store;
}

// Utility for creating reactive connection status
export function useConnectionStatus(): Readable<'connected' | 'disconnected' | 'connecting'> {
  const client = getJotDBClient();
  
  return readable<'connected' | 'disconnected' | 'connecting'>('connecting', (set) => {
    const unsubscribeConnected = client.on('connected', () => set('connected'));
    const unsubscribeDisconnected = client.on('disconnected', () => set('disconnected'));
    
    return () => {
      unsubscribeConnected();
      unsubscribeDisconnected();
    };
  });
}

// Re-export client types and utilities
export * from '@jotdb/client';