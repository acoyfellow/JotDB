import { describe, expect, it } from 'vitest';
import { createMemoryJotDB } from '../src/store';

describe('JotStore', () => {
  it('supports typed local state, prefix scans, cursors, and capped streams', async () => {
    const store = createMemoryJotDB<{ id: number; body: string }>();
    await store.set('user:1', { id: 1, body: 'a' });
    await store.set('user:2', { id: 2, body: 'b' });
    expect((await store.scan('user:', { limit: 1 })).items).toHaveLength(1);
    await store.appendCapped('receipt', { id: 1, body: 'a' }, 2);
    await store.appendCapped('receipt', { id: 2, body: 'b' }, 2);
    await store.appendCapped('receipt', { id: 3, body: 'c' }, 2);
    expect(await store.keys('receipt:')).toHaveLength(2);
  });
});
