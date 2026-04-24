import type { DataBackend } from '../dataBackend.js'
import { getPool } from './client.js'

// Postgres-backed generic list + JSON-document primitive.
//
// Lists live in `kv_list(key, idx, value)`; JSON docs live in `kv_json(key, value)`.
// Structural item equality (for removeFromList / listIndexOf) is delegated to
// jsonb's built-in equality, which normalizes key ordering and whitespace —
// slightly stricter than the filesystem backend's JSON.stringify compare but
// matches in every case the domain callers rely on (primitives + plain objects
// the same caller wrote originally).
export class PostgresDataBackend implements DataBackend {
  async readList<T>(key: string): Promise<T[]> {
    const p = await getPool()
    const r = await p.query<{ value: T }>(
      'SELECT value FROM kv_list WHERE key = $1 ORDER BY idx',
      [key],
    )
    return r.rows.map(row => row.value)
  }

  async writeList<T>(key: string, items: T[]): Promise<void> {
    const p = await getPool()
    const client = await p.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM kv_list WHERE key = $1', [key])
      for (let i = 0; i < items.length; i++) {
        await client.query(
          'INSERT INTO kv_list (key, idx, value) VALUES ($1, $2, $3)',
          [key, i, JSON.stringify(items[i])],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async appendToList<T>(key: string, item: T): Promise<number> {
    const p = await getPool()
    const client = await p.connect()
    try {
      await client.query('BEGIN')
      const r = await client.query<{ next: number }>(
        'SELECT COALESCE(MAX(idx) + 1, 0) AS next FROM kv_list WHERE key = $1',
        [key],
      )
      const idx = Number(r.rows[0].next)
      await client.query(
        'INSERT INTO kv_list (key, idx, value) VALUES ($1, $2, $3)',
        [key, idx, JSON.stringify(item)],
      )
      await client.query('COMMIT')
      return idx
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async removeFromList<T>(key: string, item: T): Promise<void> {
    const p = await getPool()
    const client = await p.connect()
    try {
      await client.query('BEGIN')
      // Match the first (lowest-idx) structurally-equal row and delete it,
      // then shift subsequent idx's down so the list stays contiguous — same
      // semantics as the filesystem splice().
      const r = await client.query<{ idx: number }>(
        'SELECT idx FROM kv_list WHERE key = $1 AND value = $2::jsonb ORDER BY idx LIMIT 1',
        [key, JSON.stringify(item)],
      )
      if (r.rowCount && r.rowCount > 0) {
        const target = Number(r.rows[0].idx)
        await client.query('DELETE FROM kv_list WHERE key = $1 AND idx = $2', [key, target])
        await client.query(
          'UPDATE kv_list SET idx = idx - 1 WHERE key = $1 AND idx > $2',
          [key, target],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async listCount(key: string): Promise<number> {
    const p = await getPool()
    const r = await p.query<{ c: string }>(
      'SELECT COUNT(*)::text AS c FROM kv_list WHERE key = $1',
      [key],
    )
    return Number(r.rows[0].c)
  }

  async listIndexOf<T>(key: string, item: T): Promise<number> {
    const p = await getPool()
    const r = await p.query<{ idx: number }>(
      'SELECT idx FROM kv_list WHERE key = $1 AND value = $2::jsonb ORDER BY idx LIMIT 1',
      [key, JSON.stringify(item)],
    )
    if (!r.rowCount) return -1
    return Number(r.rows[0].idx)
  }

  async readJson<T>(key: string): Promise<T | null> {
    const p = await getPool()
    const r = await p.query<{ value: T }>(
      'SELECT value FROM kv_json WHERE key = $1',
      [key],
    )
    if (!r.rowCount) return null
    return r.rows[0].value
  }

  async writeJson<T>(key: string, value: T): Promise<void> {
    const p = await getPool()
    await p.query(
      `INSERT INTO kv_json (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    )
  }

  async deleteJson(key: string): Promise<void> {
    const p = await getPool()
    await p.query('DELETE FROM kv_json WHERE key = $1', [key])
  }
}
