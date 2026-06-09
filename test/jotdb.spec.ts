import { describe, it, expect } from 'vitest';
import { JotDB } from '../src/index';

class MemoryStorage {
  data = new Map<string, unknown>();
  async get(key: string) { return this.data.get(key); }
  async put(key: string, value: unknown) { this.data.set(key, value); }
}

function db() {
  return new JotDB({ storage: new MemoryStorage() } as any, {} as any);
}

describe('JotDB eval suite', () => {
  it('survives concurrent writes to one actor', async () => {
    const d = db();
    await d.setSchema({});
    await Promise.all(Array.from({ length: 1000 }, async (_, i) => d.set(`k${i}`, i)));
    const all = await d.getAll() as Record<string, number>;
    expect(Object.keys(all)).toHaveLength(1000);
    expect(all.k999).toBe(999);
  });

  it('validates invalid schema writes without corrupting state', async () => {
    const d = db();
    await d.setSchema({ name: 'string', age: 'number' });
    await d.setAll({ name: 'A', age: 1 });
    await expect(d.setAll({ name: 2, age: 'bad' } as any)).rejects.toThrow();
    expect(await d.getAll()).toEqual({ name: 'A', age: 1 });
  });

  it('enforces read-only for set', async () => {
    const d = db();
    await d.setOptions({ readOnly: true });
    await expect(d.set('x', 1)).rejects.toThrow('read-only');
  });

  it('keeps isolated instances isolated', async () => {
    const instances = await Promise.all(Array.from({ length: 100 }, async (_, i) => {
      const d = db();
      await d.set('id', i);
      return d;
    }));
    await Promise.all(instances.map(async (d, i) => expect(await d.get('id')).toBe(i)));
  });

  it('caps audit log at 100 entries', async () => {
    const d = db();
    for (let i = 0; i < 125; i++) await d.set(`k${i}`, i);
    expect((await d.getAuditLog())).toHaveLength(100);
  });

  it('supports large object payloads', async () => {
    const d = db();
    const payload = 'x'.repeat(1024 * 1024);
    await d.set('payload', payload);
    expect((await d.get('payload'))?.length).toBe(payload.length);
  });

  it('supports array append throughput', async () => {
    const d = db();
    await d.setAll([]);
    for (let i = 0; i < 1000; i++) await d.push(i);
    const all = await d.getAll() as number[];
    expect(all).toHaveLength(1000);
    expect(all[999]).toBe(999);
  });
});
