import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  JotDBClient, 
  Collection, 
  DocumentReference,
  DocumentSnapshot,
  QuerySnapshot,
  type JotDBClientConfig,
  type ZodSchema
} from '@jotdb/client';

// React-specific hook return types
export interface UseCollectionResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  add: (data: T) => Promise<DocumentSnapshot<T>>;
  refresh: () => Promise<void>;
}

export interface UseDocumentResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  set: (data: T) => Promise<DocumentSnapshot<T>>;
  update: (data: Partial<T>) => Promise<DocumentSnapshot<T>>;
  delete: () => Promise<void>;
  refresh: () => Promise<void>;
}

export interface UseConnectionStatusResult {
  status: 'connected' | 'disconnected' | 'connecting';
  isConnected: boolean;
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
): UseCollectionResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const client = getJotDBClient();
  const collection = client.collection(name, schema);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const snapshot = await collection.get();
      setData(snapshot.docs.map(doc => doc.data));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [collection]);

  const add = useCallback(async (newData: T) => {
    try {
      setError(null);
      return await collection.add(newData);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, [collection]);

  useEffect(() => {
    // Set up real-time subscription
    unsubscribeRef.current = collection.onSnapshot((snapshot: QuerySnapshot<T>) => {
      setData(snapshot.docs.map(doc => doc.data));
      setLoading(false);
      setError(null);
    });

    return () => {
      unsubscribeRef.current?.();
    };
  }, [collection]);

  return { data, loading, error, add, refresh };
}

export function useDocument<T = unknown>(
  collectionName: string,
  documentId: string,
  schema?: ZodSchema<T>
): UseDocumentResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const client = getJotDBClient();
  const collection = client.collection(collectionName, schema);
  const doc = collection.doc(documentId);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const snapshot = await doc.get();
      setData(snapshot.exists ? snapshot.data : null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [doc]);

  const set = useCallback(async (newData: T) => {
    try {
      setError(null);
      return await doc.set(newData);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, [doc]);

  const update = useCallback(async (newData: Partial<T>) => {
    try {
      setError(null);
      return await doc.update(newData);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, [doc]);

  const deleteDoc = useCallback(async () => {
    try {
      setError(null);
      await doc.delete();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, [doc]);

  useEffect(() => {
    // Set up real-time subscription
    unsubscribeRef.current = doc.onSnapshot((snapshot: DocumentSnapshot<T>) => {
      setData(snapshot.exists ? snapshot.data : null);
      setLoading(false);
      setError(null);
    });

    return () => {
      unsubscribeRef.current?.();
    };
  }, [doc]);

  return { 
    data, 
    loading, 
    error, 
    set, 
    update, 
    delete: deleteDoc, 
    refresh 
  };
}

export function useConnectionStatus(): UseConnectionStatusResult {
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  
  const client = getJotDBClient();

  useEffect(() => {
    const unsubscribeConnected = client.on('connected', () => setStatus('connected'));
    const unsubscribeDisconnected = client.on('disconnected', () => setStatus('disconnected'));
    
    return () => {
      unsubscribeConnected();
      unsubscribeDisconnected();
    };
  }, [client]);

  return {
    status,
    isConnected: status === 'connected'
  };
}

// Re-export client types and utilities
export * from '@jotdb/client';