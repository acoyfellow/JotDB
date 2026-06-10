import { describe, expect, it } from 'vitest';
import { SQLiteStoreAdapter, JotStore } from '../src/store';

class SQL {
  rows = new Map<string, { value: string; created_at: number }>();
  exec(query: string, ...args: any[]) {
    if (query.startsWith('CREATE')) return { one: () => undefined, toArray: () => [] };
    if (query.startsWith('INSERT')) { this.rows.set(args[0], { value: args[1], created_at: args[2] }); return { one: () => undefined, toArray: () => [] }; }
    if (query.startsWith('DELETE FROM jotdb_records WHERE key =')) { this.rows.delete(args[0]); return { one: () => undefined, toArray: () => [] }; }
    if (query.startsWith('SELECT value')) { const row = this.rows.get(args[0]); return { one: () => row ? { value: row.value } : undefined, toArray: () => [] }; }
    if (query.startsWith('SELECT key, value')) { const prefix = args[0].slice(0, -1); const cursor = args[1]; const limit = args[3]; const rows = [...this.rows.entries()].filter(([k]) => k.startsWith(prefix) && (!cursor || k > cursor)).sort(([a],[b]) => a.localeCompare(b)).slice(0, limit).map(([key,v]) => ({ key, value: v.value })); return { one: () => undefined, toArray: () => rows }; }
    if (query.startsWith('SELECT key')) { const prefix = args[0].slice(0, -1); return { one: () => undefined, toArray: () => [...this.rows.keys()].filter(k => k.startsWith(prefix)).sort().map(key => ({ key })) }; }
    return { one: () => undefined, toArray: () => [] };
  }
}

describe('SQLiteStoreAdapter', () => {
  it('supports persisted scans and cursors', async () => {
    const store = new JotStore(new SQLiteStoreAdapter<{ id: number }>(new SQL()));
    await store.set('receipt:1', { id: 1 });
    await store.set('receipt:2', { id: 2 });
    const first = await store.scan('receipt:', { limit: 1 });
    expect(first.items).toEqual([{ id: 1 }]);
    const second = await store.scan('receipt:', { limit: 1, cursor: first.cursor });
    expect(second.items).toEqual([{ id: 2 }]);
  });
});
