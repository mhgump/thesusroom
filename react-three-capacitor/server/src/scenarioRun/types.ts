import type { LogEntry } from '../../scripts/logFormat.js'

// POST /scenario-run request body. The CLI/tool builds this and the server
// prepares a one-shot room behind the `sr_<routing_run_id>` routing key. The
// server does NOT spawn CLI bots — the caller connects them over the returned
// routing key directly. The server DOES spawn scenario-internal bots (via
// ctx.spawnBot) and ticks the room until termination or timeout.
export interface ScenarioRunRequest {
  // Echoed back in the response and server logs; has no routing meaning.
  run_id: string
  scenario_id: string
  test_spec_name: string
  run_index: number
  bot_count: number
  record_bot_index: number | null
  // Advisory — the server can't filter CLI-bot logs (those live on the CLI
  // side). It forwards the value so the CLI knows what to filter before
  // writing response.json.
  log_bot_indices: number[] | null
  // null → use the scenario spec's own timeout.
  timeout_ms: number | null
  tick_rate_hz: number
}

export interface ScenarioRunRegistered {
  run_id: string
  routing_key: string
  routing_run_id: string
  effective_timeout_ms: number
}

// Final scenario state captured at termination (either `ctx.terminate()` or
// timeout). Survivors = players still attached to the room when the run ends;
// eliminated / disconnected players have already been removed by the Room.
export interface ScenarioRunFinalState {
  survivor_count: number
  survivor_player_ids: string[]
}

// GET /scenario-run/:id/result response. Server-side portion only: the CLI
// merges these logs with its own CLI-bot logs to build the final
// `ScenarioRunResult` written to disk.
export interface ScenarioRunServerResult {
  run_id: string
  termination_metadata: {
    terminated_by: 'scenario' | 'timeout'
    exit_code: number
    observer_ready_fired: boolean
    final_state: ScenarioRunFinalState
  }
  effective_timeout_ms: number
  scenario_bot_logs: LogEntry[]
  server_logs: LogEntry[]
}
