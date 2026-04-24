// Persistent description of a scenario-run attempt by the Run-Scenario Agent.
//
// Test specs live on disk at content/test_specs/{name}.json. Each spec
// captures the scenario / map / bots / opts that were tried, plus a growing
// list of notes — the agent's reasoning about the attempt — and the artifact
// ids of every run produced against this spec.

export interface RunScenarioSpecBot {
  // Path relative to repo root, e.g. "content/bots/demo/demoBot.ts".
  path: string
  // Exported BotSpec name, e.g. "DEMO_BOT".
  export: string
}

export interface RunScenarioSpecOpts {
  // Bot index whose POV to record to video.
  record_video_bot_index?: number
  // Scenario timeout override (ms).
  timeout_ms?: number
  // Bot indices whose logs to prioritise when collecting artifacts.
  collect_log_bot_indices?: number[]
}

export interface RunScenarioSpecNote {
  // Date.now() when the note was appended.
  time: number
  // Who wrote the note (e.g. "run-scenario-agent").
  author: string
  // Freeform content.
  text: string
}

export interface RunScenarioSpec {
  name: string
  scenario_id: string
  map_id: string
  bots: RunScenarioSpecBot[]
  opts: RunScenarioSpecOpts
  notes: RunScenarioSpecNote[]
  // Artifact ids for every run_scenario_from_spec execution against this
  // spec, in chronological order. Appended by run_scenario_from_spec.
  last_run_artifact_ids: string[]
}
