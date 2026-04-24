import express from 'express'
import type { GameServer } from '../GameServer.js'
import type { ScenarioRunRequest } from './types.js'

// Long-poll budget for GET /scenario-run/:id/result. 25s gives proxies /
// load balancers with 30s idle timeouts enough slack. Clients that receive
// `pending` (202) should reissue the request.
const LONG_POLL_MS = 25_000

function validateRequest(body: unknown): ScenarioRunRequest {
  if (!body || typeof body !== 'object') throw new Error('body must be an object')
  const b = body as Partial<ScenarioRunRequest>
  const str = (v: unknown, name: string): string => {
    if (typeof v !== 'string' || v.length === 0) throw new Error(`${name} must be a non-empty string`)
    return v
  }
  const int = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`${name} must be an integer`)
    return v
  }
  const run_id = str(b.run_id, 'run_id')
  const scenario_id = str(b.scenario_id, 'scenario_id')
  const test_spec_name = str(b.test_spec_name, 'test_spec_name')
  const run_index = int(b.run_index, 'run_index')
  const bot_count = int(b.bot_count, 'bot_count')
  if (bot_count < 0) throw new Error('bot_count must be non-negative')
  let record_bot_index: number | null = null
  if (b.record_bot_index !== null && b.record_bot_index !== undefined) {
    const v = int(b.record_bot_index, 'record_bot_index')
    if (v < 0 || v >= bot_count) throw new Error(`record_bot_index must be in [0, ${bot_count})`)
    record_bot_index = v
  }
  let log_bot_indices: number[] | null = null
  if (b.log_bot_indices !== null && b.log_bot_indices !== undefined) {
    if (!Array.isArray(b.log_bot_indices)) throw new Error('log_bot_indices must be an array')
    for (const v of b.log_bot_indices) {
      if (!Number.isInteger(v) || v < 0 || v >= bot_count) {
        throw new Error(`log_bot_indices contains ${v}; must be in [0, ${bot_count})`)
      }
    }
    log_bot_indices = [...b.log_bot_indices]
  }
  let timeout_ms: number | null = null
  if (b.timeout_ms !== null && b.timeout_ms !== undefined) {
    const v = int(b.timeout_ms, 'timeout_ms')
    if (v < 1) throw new Error('timeout_ms must be a positive integer')
    timeout_ms = v
  }
  const tick_rate_hz = typeof b.tick_rate_hz === 'number' ? b.tick_rate_hz : 240
  if (!Number.isFinite(tick_rate_hz) || tick_rate_hz <= 0) {
    throw new Error('tick_rate_hz must be a positive finite number')
  }

  return {
    run_id,
    scenario_id,
    test_spec_name,
    run_index,
    bot_count,
    record_bot_index,
    log_bot_indices,
    timeout_ms,
    tick_rate_hz,
  }
}

export function attachScenarioRunRoutes(app: express.Express, gameServer: GameServer): void {
  app.use(express.json({ limit: '64kb' }))

  app.post('/scenario-run', async (req, res) => {
    let parsed: ScenarioRunRequest
    try {
      parsed = validateRequest(req.body)
    } catch (err) {
      res.status(400).json({ error: String(err instanceof Error ? err.message : err) })
      return
    }
    try {
      const registered = await gameServer.getScenarioRunRegistry().register(parsed)
      res.status(201).json(registered)
    } catch (err) {
      console.error('[scenarioRunRoutes] register failed:', err)
      res.status(400).json({ error: String(err instanceof Error ? err.message : err) })
    }
  })

  app.get('/scenario-run/:id/result', async (req, res) => {
    const id = req.params.id
    const registry = gameServer.getScenarioRunRegistry()
    if (!registry.get(id)) {
      res.status(404).json({ error: 'Unknown run' })
      return
    }
    try {
      const result = await registry.awaitResult(id, LONG_POLL_MS)
      if (result === 'pending') {
        res.status(202).json({ status: 'pending' })
        return
      }
      // Dispose after a successful read so the registry doesn't leak. A
      // retrying client that lost the 200 response will now see 404; this is
      // acceptable because the CLI writes the result to disk on first
      // receipt.
      registry.dispose(id)
      res.status(200).json(result)
    } catch (err) {
      console.error(`[scenarioRunRoutes] awaitResult(${id}) failed:`, err)
      res.status(500).json({ error: String(err instanceof Error ? err.message : err) })
    }
  })
}
