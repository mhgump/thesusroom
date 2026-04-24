import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { gzip as gzipCb, gunzip as gunzipCb } from 'node:zlib'
import type { ScenarioRunBackend } from '../backends.js'
import type { RunResultKey, ScenarioRunResult } from '../types.js'
import { getPool } from './client.js'

const gzip = promisify(gzipCb)
const gunzip = promisify(gunzipCb)

// Postgres layout:
//   scenario_runs(scenario, test_spec, idx, response jsonb)
//   scenario_run_blobs(scenario, test_spec, idx, filename, content_gz bytea)
//
// Sibling artifacts (mp4 / png / etc.) are gzip-compressed and stored in
// scenario_run_blobs, keyed by filename relative to the run's staging dir.
// `locate()` returns a per-run subdirectory under the OS tmp dir so the
// run-scenario child process has a real filesystem path to write into —
// `putBlobs()` ingests that directory after the child exits.
export class PostgresScenarioRunResultBackend implements ScenarioRunBackend {
  async get(key: RunResultKey): Promise<ScenarioRunResult | null> {
    const p = await getPool()
    const r = await p.query<{ response: ScenarioRunResult }>(
      'SELECT response FROM scenario_runs WHERE scenario = $1 AND test_spec = $2 AND idx = $3',
      [key.scenario, key.test_spec, key.index],
    )
    if (!r.rowCount) return null
    return r.rows[0].response
  }

  async put(key: RunResultKey, value: ScenarioRunResult): Promise<void> {
    const p = await getPool()
    await p.query(
      `INSERT INTO scenario_runs (scenario, test_spec, idx, response)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (scenario, test_spec, idx) DO UPDATE SET response = EXCLUDED.response`,
      [key.scenario, key.test_spec, key.index, JSON.stringify(value)],
    )
  }

  async delete(key: RunResultKey): Promise<void> {
    const p = await getPool()
    const client = await p.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        'DELETE FROM scenario_run_blobs WHERE scenario = $1 AND test_spec = $2 AND idx = $3',
        [key.scenario, key.test_spec, key.index],
      )
      await client.query(
        'DELETE FROM scenario_runs WHERE scenario = $1 AND test_spec = $2 AND idx = $3',
        [key.scenario, key.test_spec, key.index],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async list(): Promise<{ key: RunResultKey; value: ScenarioRunResult }[]> {
    const p = await getPool()
    const r = await p.query<{ scenario: string; test_spec: string; idx: number; response: ScenarioRunResult }>(
      'SELECT scenario, test_spec, idx, response FROM scenario_runs ORDER BY scenario, test_spec, idx',
    )
    return r.rows.map(row => ({
      key: { scenario: row.scenario, test_spec: row.test_spec, index: Number(row.idx) },
      value: row.response,
    }))
  }

  // Stable per-run staging dir. The run-scenario child writes response.json,
  // video, and screenshot here; the caller then feeds it to put() + putBlobs().
  locate(key: RunResultKey): string | null {
    return path.join(
      os.tmpdir(),
      'scenario_runs_tmp',
      key.scenario,
      key.test_spec,
      String(key.index),
    )
  }

  async nextIndex(scenario: string, test_spec: string): Promise<number> {
    const p = await getPool()
    const r = await p.query<{ next: number }>(
      `SELECT COALESCE(MAX(idx) + 1, 0) AS next
       FROM scenario_runs WHERE scenario = $1 AND test_spec = $2`,
      [scenario, test_spec],
    )
    return Number(r.rows[0].next)
  }

  async putBlobs(key: RunResultKey, dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    const p = await getPool()
    for (const e of entries) {
      if (!e.isFile()) continue
      if (e.name === 'response.json') continue
      const abs = path.join(dir, e.name)
      const data = await fs.readFile(abs)
      const gz = await gzip(data)
      await p.query(
        `INSERT INTO scenario_run_blobs (scenario, test_spec, idx, filename, content_gz)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (scenario, test_spec, idx, filename) DO UPDATE SET content_gz = EXCLUDED.content_gz`,
        [key.scenario, key.test_spec, key.index, e.name, gz],
      )
    }
  }

  async getBlob(key: RunResultKey, filename: string): Promise<Buffer | null> {
    const p = await getPool()
    const r = await p.query<{ content_gz: Buffer }>(
      'SELECT content_gz FROM scenario_run_blobs WHERE scenario = $1 AND test_spec = $2 AND idx = $3 AND filename = $4',
      [key.scenario, key.test_spec, key.index, filename],
    )
    if (!r.rowCount) return null
    return gunzip(r.rows[0].content_gz)
  }

  async listBlobs(key: RunResultKey): Promise<string[]> {
    const p = await getPool()
    const r = await p.query<{ filename: string }>(
      'SELECT filename FROM scenario_run_blobs WHERE scenario = $1 AND test_spec = $2 AND idx = $3 ORDER BY filename',
      [key.scenario, key.test_spec, key.index],
    )
    return r.rows.map(row => row.filename)
  }
}
