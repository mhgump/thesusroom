// LLM-driven orchestrator for a scenario's full life-cycle.
//
// The TypeScript wrapper handles two things the LLM cannot:
//   1. `gcloud auth print-access-token` pre-flight so the whole run fails
//      fast with a clear message if the caller isn't authenticated.
//   2. A `withRunLog('create-scenario', ...)` scope so the LLM loop and
//      every sub-agent it invokes land in a single logs/ tree.
//
// Everything else — which sub-agents to call, whether to reuse existing
// content via load_scenario_context, when to regress-check, when to record
// hero-POV videos — lives in the system prompt at
// skills/create-scenario-agent/prompt.md. See that file for the canonical
// pipeline. The tool surface is declared in `TOOLS` below.

import path from 'node:path'
import { spawn } from 'node:child_process'
import type { Tool } from '../framework.js'
import { PROJECT_ROOT } from '../_shared/paths.js'
import { runAgent, type AgentRunResult, type ResponseSpec } from '../_shared/agentLoop.js'
import { withRunLog } from '../_shared/logContext.js'
import { loadSkill } from './_loadPrompt.js'
// Sub-agent tool wrappers.
import { SCENARIO_PLAN_AGENT_TOOL } from '../scenarioPlanAgentTool/index.js'
import { MAP_AGENT_TOOL } from '../mapAgentTool/index.js'
import { BOT_AGENT_TOOL } from '../botAgentTool/index.js'
import { SCENARIO_AGENT_TOOL } from '../scenarioAgentTool/index.js'
import { DIRECT_AGENT_TOOL } from '../directAgentTool/index.js'
import { RUN_SCENARIO_AGENT_TOOL } from '../runScenarioAgentTool/index.js'
// Context loading.
import { LOAD_SCENARIO_CONTEXT_TOOL } from '../loadScenarioContext/index.js'
// Primitives.
import { INSERT_SCENARIO_PLAN_TOOL } from '../insertScenarioPlan/index.js'
import { INSERT_MAP_TOOL } from '../insertMap/index.js'
import { INSERT_SCENARIO_TOOL } from '../insertScenario/index.js'
import { INSERT_BOT_TOOL } from '../insertBot/index.js'
import { INSERT_RUN_SCENARIO_SPEC_TOOL } from '../insertRunScenarioSpec/index.js'
import { RUN_SCENARIO_FROM_SPEC_TOOL } from '../runScenarioFromSpec/index.js'
import { RUN_SCENARIO_WITH_BOTS_TOOL } from '../runScenarioWithBots/index.js'
import { ADD_NOTES_TO_TEST_SPEC_TOOL } from '../addNotesToTestSpec/index.js'
import { READ_TEST_SPEC_TOOL } from '../readTestSpec/index.js'
import { LIST_CONTENT_TOOL } from '../listContent/index.js'
import { GET_SCENARIO_LOGS_TOOL } from '../getScenarioLogs/index.js'
import { GET_BOT_LOGS_TOOL } from '../getBotLogs/index.js'
import type { OutcomePersonaCount } from '../insertScenarioPlan/index.js'

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface CreateScenarioFailedOutcome {
  test_spec_name: string
  personas: OutcomePersonaCount[]
  expected_survivors: number
  failure_reason_summary: string
}

export interface CreateScenarioAgentResponse {
  goal_achieved: boolean
  plan_name: string
  scenario_id: string
  passing_specs: string[]
  failed_outcomes: CreateScenarioFailedOutcome[]
  num_edit_failures: number
  failure_reason_summary: string
  // Repo-relative path to the top-level log dir. Populated by the wrapper.
  log_dir: string
}

export interface CreateScenarioAgentOpts {
  verbose?: boolean
  // Forwarded to the top-level LLM loop. Default 80.
  maxIterations?: number
}

// ---------------------------------------------------------------------------
// Response schema for the record tool
// ---------------------------------------------------------------------------

export const CREATE_SCENARIO_RESPONSE_SPEC: ResponseSpec = {
  description:
    '{ goal_achieved, plan_name, scenario_id, passing_specs, ' +
    'failed_outcomes, num_edit_failures, failure_reason_summary } — the ' +
    'final verdict for this create-scenario run. goal_achieved is true iff ' +
    'every outcome in the plan has an end-to-end-passing test spec. ' +
    'passing_specs lists the test_spec_names that validated (including the ' +
    'hero-POV re-recording). failed_outcomes describes anything left ' +
    'unfinished. log_dir is added by the wrapper; do not set it.',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'goal_achieved',
      'plan_name',
      'scenario_id',
      'passing_specs',
      'failed_outcomes',
      'num_edit_failures',
      'failure_reason_summary',
    ],
    properties: {
      goal_achieved: {
        type: 'boolean',
        description: 'True iff every outcome has a passing spec.',
      },
      plan_name: {
        type: 'string',
        description: 'plan_id the orchestrator worked against.',
      },
      scenario_id: {
        type: 'string',
        description:
          'Scenario slug. Equals plan_name on success; empty string when ' +
          'the plan stage never produced a plan.',
      },
      passing_specs: {
        type: 'array',
        items: { type: 'string' },
        description: 'test_spec_names that validated end-to-end.',
      },
      failed_outcomes: {
        type: 'array',
        description: 'Outcomes that did not reach a passing spec.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['test_spec_name', 'personas', 'expected_survivors', 'failure_reason_summary'],
          properties: {
            test_spec_name: { type: 'string' },
            expected_survivors: { type: 'integer', minimum: 0 },
            personas: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'count'],
                properties: {
                  name: { type: 'string' },
                  count: { type: 'integer', minimum: 1 },
                },
              },
            },
            failure_reason_summary: { type: 'string' },
          },
        },
      },
      num_edit_failures: {
        type: 'integer',
        minimum: 0,
        description:
          'Total sub-agent retries the orchestrator performed (direct_agent ' +
          'retries + any other visible rework).',
      },
      failure_reason_summary: {
        type: 'string',
        description: 'Empty when goal_achieved; otherwise short blocker reason.',
      },
    },
  },
}

// ---------------------------------------------------------------------------
// Tool surface for the top-level agent
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  // Sub-agents.
  SCENARIO_PLAN_AGENT_TOOL as Tool,
  MAP_AGENT_TOOL as Tool,
  BOT_AGENT_TOOL as Tool,
  SCENARIO_AGENT_TOOL as Tool,
  DIRECT_AGENT_TOOL as Tool,
  RUN_SCENARIO_AGENT_TOOL as Tool,
  // Context loading.
  LOAD_SCENARIO_CONTEXT_TOOL as Tool,
  // Primitives.
  INSERT_SCENARIO_PLAN_TOOL as Tool,
  INSERT_MAP_TOOL as Tool,
  INSERT_SCENARIO_TOOL as Tool,
  INSERT_BOT_TOOL as Tool,
  INSERT_RUN_SCENARIO_SPEC_TOOL as Tool,
  RUN_SCENARIO_FROM_SPEC_TOOL as Tool,
  RUN_SCENARIO_WITH_BOTS_TOOL as Tool,
  ADD_NOTES_TO_TEST_SPEC_TOOL as Tool,
  READ_TEST_SPEC_TOOL as Tool,
  LIST_CONTENT_TOOL as Tool,
  GET_SCENARIO_LOGS_TOOL as Tool,
  GET_BOT_LOGS_TOOL as Tool,
]

// ---------------------------------------------------------------------------
// Pre-flight: gcloud auth
// ---------------------------------------------------------------------------

async function checkGcloudAuth(): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise(resolve => {
    const child = spawn('gcloud', ['auth', 'print-access-token'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', err => resolve({ ok: false, error: err.message }))
    child.on('close', code => {
      if (code === 0) resolve({ ok: true })
      else resolve({ ok: false, error: stderr.trim() || `exit ${code}` })
    })
  })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runCreateScenarioAgent(
  userBrief: string,
  opts: CreateScenarioAgentOpts = {},
): Promise<CreateScenarioAgentResponse> {
  const auth = await checkGcloudAuth()
  if (!auth.ok) {
    return {
      goal_achieved: false,
      plan_name: '',
      scenario_id: '',
      passing_specs: [],
      failed_outcomes: [],
      num_edit_failures: 0,
      failure_reason_summary:
        `gcloud auth preflight failed — run \`gcloud auth login\` before ` +
        `invoking create-scenario. Underlying error: ${auth.error}`,
      log_dir: '',
    }
  }

  return withRunLog('create-scenario', { brief: userBrief, opts }, async log => {
    const result: AgentRunResult<CreateScenarioAgentResponse> =
      await runAgent<CreateScenarioAgentResponse>({
        systemPrompt: loadSkill('create-scenario-agent'),
        userPrompt: userBrief,
        tools: TOOLS,
        responseSpec: CREATE_SCENARIO_RESPONSE_SPEC,
        verbose: opts.verbose,
        maxIterations: opts.maxIterations ?? 80,
      })
    return {
      ...result.response,
      log_dir: path.relative(PROJECT_ROOT, log.dir),
    }
  })
}
