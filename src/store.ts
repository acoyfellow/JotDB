export interface StoreCursor<T> { items: T[]; cursor?: string }
export interface StoreAdapter<T> {
  get(key: string): Promise<T | undefined>
  set(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  scan(prefix?: string, options?: { limit?: number; cursor?: string }): Promise<StoreCursor<T>>
}

export class MemoryStoreAdapter<T> implements StoreAdapter<T> {
  private data = new Map<string, T>()
  async get(key: string) { return this.data.get(key) }
  async set(key: string, value: T) { this.data.set(key, value) }
  async delete(key: string) { this.data.delete(key) }
  async keys(prefix = '') { return [...this.data.keys()].sort().filter((key) => key.startsWith(prefix)) }
  async scan(prefix = '', options: { limit?: number; cursor?: string } = {}) {
    const keys = await this.keys(prefix)
    const cursor = options.cursor
    const start = cursor ? Math.max(0, keys.findIndex((key) => key > cursor)) : 0
    const page = keys.slice(start, options.limit ? start + options.limit : undefined)
    return { items: page.map((key) => this.data.get(key)!), cursor: page.length && page.length < keys.length ? page.at(-1) : undefined }
  }
}

export class JotStore<T> {
  constructor(private adapter: StoreAdapter<T>) {}
  get(key: string) { return this.adapter.get(key) }
  set(key: string, value: T) { return this.adapter.set(key, value) }
  delete(key: string) { return this.adapter.delete(key) }
  keys(prefix = '') { return this.adapter.keys(prefix) }
  scan(prefix = '', options?: { limit?: number; cursor?: string }) { return this.adapter.scan(prefix, options) }
  async append(stream: string, value: T) {
    const key = `${stream}:${Date.now().toString().padStart(13, '0')}:${crypto.randomUUID()}`
    await this.set(key, value)
    return key
  }
  async retention(prefix: string, maxAgeMs: number) {
    if ('retention' in this.adapter) return (this.adapter as SQLiteStoreAdapter<T>).retention(prefix, maxAgeMs)
  }
  async appendCapped(stream: string, value: T, max: number) {
    const key = await this.append(stream, value)
    const keys = await this.keys(`${stream}:`)
    await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((old) => this.delete(old)))
    return key
  }
}

export class SQLiteStoreAdapter<T> implements StoreAdapter<T> {
  constructor(private sql: any) {
    this.sql.exec('CREATE TABLE IF NOT EXISTS jotdb_records (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL)')
    this.sql.exec('CREATE INDEX IF NOT EXISTS jotdb_records_key_idx ON jotdb_records(key)')
  }
  async get(key: string) {
    const row = this.sql.exec('SELECT value FROM jotdb_records WHERE key = ?', key).one()
    return row ? JSON.parse(row.value) as T : undefined
  }
  async set(key: string, value: T) {
    this.sql.exec('INSERT INTO jotdb_records(key, value, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at', key, JSON.stringify(value), Date.now())
  }
  async delete(key: string) { this.sql.exec('DELETE FROM jotdb_records WHERE key = ?', key) }
  async keys(prefix = '') { return this.sql.exec('SELECT key FROM jotdb_records WHERE key LIKE ? ORDER BY key', `${prefix}%`).toArray().map((row: any) => row.key) }
  async scan(prefix = '', options: { limit?: number; cursor?: string } = {}) {
    const limit = options.limit ?? 100
    const rows = this.sql.exec('SELECT key, value FROM jotdb_records WHERE key LIKE ? AND (? IS NULL OR key > ?) ORDER BY key LIMIT ?', `${prefix}%`, options.cursor ?? null, options.cursor ?? null, limit).toArray()
    return { items: rows.map((row: any) => JSON.parse(row.value) as T), cursor: rows.length === limit ? rows.at(-1).key : undefined }
  }
  async retention(prefix: string, maxAgeMs: number) { this.sql.exec('DELETE FROM jotdb_records WHERE key LIKE ? AND created_at < ?', `${prefix}%`, Date.now() - maxAgeMs) }
}

export function createMemoryJotDB<T>() { return new JotStore<T>(new MemoryStoreAdapter<T>()) }
