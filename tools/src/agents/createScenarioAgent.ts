// Deterministic orchestrator that drives a scenario's full life-cycle:
//
//   natural-language brief
//     → scenario-plan-agent (produces a validated plan JSON)
//     → map-agent + bot-agent (parallel per persona) + scenario-agent
//     → for each outcome:
//         - snapshot the scenario/map/bots tree
//         - runDirectAgent to author + confirm a passing test spec
//         - re-run every previously-passing spec as a regression check
//         - on failure or regression, restore the snapshot and retry
//
// This is NOT a model loop — it's TypeScript that calls the LLM-driven
// sub-agents as primitives. Bounded retries use a global failure cap so the
// whole run cannot diverge on one pathological outcome.

import fs from 'node:fs'
import path from 'node:path'
import { CONTENT_DIR } from '../_shared/paths.js'
import {
  snapshotScenarioTree,
  restoreScenarioTree,
  dropScenarioTreeSnapshot,
  type ScenarioTreeSnapshot,
} from '../_shared/snapshotScenarioTree.js'
import { runScenarioPlanAgent } from './scenarioPlanAgent.js'
import { runMapAgent } from './mapAgent.js'
import { runBotAgent } from './botAgent.js'
import { runScenarioAgent } from './scenarioAgent.js'
import { runDirectAgent } from './directAgent.js'
import { RUN_SCENARIO_FROM_SPEC_TOOL } from '../runScenarioFromSpec/index.js'
import type {
  BotPersona,
  ExpectedOutcome,
  InsertScenarioPlanInput,
  OutcomePersonaCount,
} from '../insertScenarioPlan/index.js'

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
}

export interface CreateScenarioAgentOpts {
  verbose?: boolean
  // Cap on GLOBAL edit failures across all outcomes. Default 5.
  maxEditFailures?: number
  // Forwarded to each sub-agent.
  subAgentMaxIterations?: number
  // Forwarded to the direct-agent loop. Default 60 (matches directAgent.ts).
  directAgentMaxIterations?: number
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function log(verbose: boolean | undefined, msg: string): void {
  if (verbose) process.stderr.write(`[create-scenario] ${msg}\n`)
}

function outcomeTestSpecName(index: number): string {
  return `outcome_${index}`
}

function personaExportName(personaName: string): string {
  return `${personaName.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_BOT`
}

function personaBotPath(scenarioId: string, personaName: string): string {
  return `content/bots/${scenarioId}/${personaName}/bot.ts`
}

function summarizeComposition(personas: OutcomePersonaCount[]): string {
  return personas.map(p => `${p.count}× ${p.name}`).join(', ')
}

function readPlan(planId: string): InsertScenarioPlanInput {
  const p = path.join(CONTENT_DIR, 'scenario_plans', `${planId}.json`)
  return JSON.parse(fs.readFileSync(p, 'utf8')) as InsertScenarioPlanInput
}

// ---------------------------------------------------------------------------
// Briefs for each sub-agent
// ---------------------------------------------------------------------------

function buildMapBrief(plan: InsertScenarioPlanInput, mapId: string): string {
  return [
    `Write the map for scenario plan "${plan.plan_id}".`,
    ``,
    `Concept: ${plan.concept_description}`,
    ``,
    `Scenario sketch:`,
    plan.scenario_sketch,
    ``,
    `Required slug (map_id): ${mapId}. The map file must live at ` +
      `content/maps/${mapId}/map.ts.`,
    `Player-count bounds: ${plan.min_player_count}–${plan.max_player_count}.`,
    `The map must support every room / door / connection the scenario sketch ` +
      `references. Do not implement scenario logic here — only geometry, ` +
      `rooms, connections, and initial visibility.`,
  ].join('\n')
}

function buildBotBrief(
  plan: InsertScenarioPlanInput,
  persona: BotPersona,
  scenarioId: string,
): string {
  return [
    `Write a bot for persona "${persona.name}" in scenario "${scenarioId}".`,
    ``,
    `Persona description: ${persona.description}`,
    ``,
    `File path: ${personaBotPath(scenarioId, persona.name)}`,
    `Export name: ${personaExportName(persona.name)}`,
    `Scenario id: ${scenarioId}`,
    ``,
    `Scenario context (for understanding the persona's behavior — do NOT ` +
      `implement scenario logic here):`,
    plan.scenario_sketch,
  ].join('\n')
}

function buildScenarioBrief(
  plan: InsertScenarioPlanInput,
  scenarioId: string,
  mapId: string,
  authoredBots: { persona: string; path: string; export: string }[],
): string {
  const botList = authoredBots
    .map(b => `  - persona="${b.persona}" path="${b.path}" export="${b.export}"`)
    .join('\n')

  return [
    `Write the scenario script for plan "${plan.plan_id}".`,
    ``,
    `Required slug (scenario_id): ${scenarioId}.`,
    `Required map_id: ${mapId} (already authored).`,
    ``,
    `Concept: ${plan.concept_description}`,
    ``,
    `Scenario sketch (implement this):`,
    plan.scenario_sketch,
    ``,
    `Possible outcomes (for awareness — the test suite will drive them ` +
      `later): ${plan.possible_outcomes_description}`,
    ``,
    `Authored bots for this scenario:`,
    botList,
    ``,
    `If the scenario sketch requires a "fill" bot (e.g. auto-filling a room ` +
      `before some trigger fires) you MAY import one of the authored bots ` +
      `above. If the sketch does not require fill, ignore them — scenario ` +
      `scripts commonly have no bot imports.`,
    ``,
    `TERMINATION: every terminal branch must call ctx.terminate(). In ` +
      `particular, any branch where all players are eliminated must still ` +
      `call ctx.terminate() — otherwise the run will time out and the test ` +
      `harness will report complete=false.`,
  ].join('\n')
}

function buildOutcomeBrief(params: {
  planId: string
  scenarioId: string
  mapId: string
  outcomeIndex: number
  outcome: ExpectedOutcome
  testSpecName: string
  authoredBots: { persona: string; path: string; export: string }[]
  failureEvidence: string[]
}): string {
  const { scenarioId, outcome, testSpecName, authoredBots } = params
  const botByPersona = new Map(authoredBots.map(b => [b.persona, b]))

  const botEntries: { path: string; export: string }[] = []
  for (const p of outcome.personas) {
    const b = botByPersona.get(p.name)
    if (!b) throw new Error(`no authored bot for persona "${p.name}"`)
    for (let i = 0; i < p.count; i++) {
      botEntries.push({ path: b.path, export: b.export })
    }
  }

  const header = [
    `Produce ONE passing test spec for scenario "${scenarioId}".`,
    ``,
    `Required test_spec_name: "${testSpecName}". You MUST create the spec ` +
      `with exactly this name — the orchestrator depends on it.`,
    ``,
    `Composition (${summarizeComposition(outcome.personas)}):`,
    botEntries.map(b => `  - { path: "${b.path}", export: "${b.export}" }`).join('\n'),
    ``,
    `Expected run result: complete=true AND survivors (= survivor_count) = ` +
      `${outcome.expected_survivors}.`,
    ``,
    `Workflow:`,
    `  1. Call insert_run_scenario_spec with scenario_id="${scenarioId}", ` +
      `test_spec_name="${testSpecName}", and the composition above.`,
    `  2. Call run_scenario_from_spec and inspect the result.`,
    `  3. If it fails the expectation, edit the scenario or the relevant ` +
      `bot(s) (insert_scenario / insert_bot or their sub-agents), then re-run.`,
    `  4. Stop when the spec's run meets the expectation.`,
    `  5. Set the top-level test_spec_name field of your final response to ` +
      `"${testSpecName}".`,
    ``,
    `NOTE: do not rename or duplicate this scenario/map — the orchestrator ` +
      `is already committed to "${scenarioId}" / map "${params.mapId}". You ` +
      `may edit any existing map/scenario/bot file to make the outcome pass.`,
  ]

  if (params.failureEvidence.length > 0) {
    header.push('')
    header.push('Prior attempts on this outcome failed. Most recent evidence:')
    for (const ev of params.failureEvidence) {
      header.push(`  - ${ev}`)
    }
  }

  return header.join('\n')
}

// ---------------------------------------------------------------------------
// The orchestrator
// ---------------------------------------------------------------------------

export async function runCreateScenarioAgent(
  userBrief: string,
  opts: CreateScenarioAgentOpts = {},
): Promise<CreateScenarioAgentResponse> {
  const verbose = opts.verbose
  const maxEditFailures = opts.maxEditFailures ?? 5

  // ----- Stage 1: plan -----------------------------------------------------

  log(verbose, 'stage 1: scenario-plan-agent')
  const planResult = await runScenarioPlanAgent(userBrief, {
    verbose,
    maxIterations: opts.subAgentMaxIterations,
  })
  if (!planResult.response.success) {
    return {
      goal_achieved: false,
      plan_name: planResult.response.plan_name,
      scenario_id: '',
      passing_specs: [],
      failed_outcomes: [],
      num_edit_failures: 0,
      failure_reason_summary:
        `scenario-plan-agent failed: ${planResult.response.failure_reason_summary}`,
    }
  }

  const planId = planResult.response.plan_name
  const plan = readPlan(planId)
  const scenarioId = planId
  const mapId = planId

  log(verbose, `plan "${planId}": ${plan.bot_personas.length} personas, ${plan.outcomes.length} outcomes`)

  // ----- Stage 2: first-pass content --------------------------------------

  log(verbose, 'stage 2a: map-agent')
  const mapResult = await runMapAgent(buildMapBrief(plan, mapId), {
    verbose,
    maxIterations: opts.subAgentMaxIterations,
  })
  if (!mapResult.response.success) {
    return {
      goal_achieved: false,
      plan_name: planId,
      scenario_id: scenarioId,
      passing_specs: [],
      failed_outcomes: [],
      num_edit_failures: 0,
      failure_reason_summary:
        `map-agent failed: ${mapResult.response.failure_reason_summary}`,
    }
  }

  log(verbose, `stage 2b: bot-agent × ${plan.bot_personas.length} (parallel)`)
  const botResults = await Promise.all(
    plan.bot_personas.map(persona =>
      runBotAgent(buildBotBrief(plan, persona, scenarioId), {
        verbose,
        maxIterations: opts.subAgentMaxIterations,
      }),
    ),
  )
  for (const [i, r] of botResults.entries()) {
    if (!r.response.success) {
      return {
        goal_achieved: false,
        plan_name: planId,
        scenario_id: scenarioId,
        passing_specs: [],
        failed_outcomes: [],
        num_edit_failures: 0,
        failure_reason_summary:
          `bot-agent failed for persona "${plan.bot_personas[i].name}": ` +
          r.response.failure_reason_summary,
      }
    }
  }

  const authoredBots = plan.bot_personas.map(p => ({
    persona: p.name,
    path: personaBotPath(scenarioId, p.name),
    export: personaExportName(p.name),
  }))

  log(verbose, 'stage 2c: scenario-agent')
  const scenarioResult = await runScenarioAgent(
    buildScenarioBrief(plan, scenarioId, mapId, authoredBots),
    { verbose, maxIterations: opts.subAgentMaxIterations },
  )
  if (!scenarioResult.response.success) {
    return {
      goal_achieved: false,
      plan_name: planId,
      scenario_id: scenarioId,
      passing_specs: [],
      failed_outcomes: [],
      num_edit_failures: 0,
      failure_reason_summary:
        `scenario-agent failed: ${scenarioResult.response.failure_reason_summary}`,
    }
  }

  // ----- Stage 3: per-outcome loop ----------------------------------------

  const passingSpecs: string[] = []
  const expectedByName = new Map<string, number>()
  const failedOutcomes: CreateScenarioFailedOutcome[] = []
  let numEditFailures = 0
  const recentFailureEvidence: string[] = []

  outer: for (let i = 0; i < plan.outcomes.length; i++) {
    const outcome = plan.outcomes[i]
    const testSpecName = outcomeTestSpecName(i)
    log(
      verbose,
      `stage 3: outcome ${i} "${testSpecName}" — ` +
        `${summarizeComposition(outcome.personas)}, expect ${outcome.expected_survivors} survivors`,
    )

    // Retry loop for this outcome. We bail to `outer` when the global
    // edit-failure cap is hit.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const snap = snapshotScenarioTree(scenarioId, mapId)

      const brief = buildOutcomeBrief({
        planId,
        scenarioId,
        mapId,
        outcomeIndex: i,
        outcome,
        testSpecName,
        authoredBots,
        // Pass the last 1–2 failures so prompts don't balloon on long runs.
        failureEvidence: recentFailureEvidence.slice(-2),
      })

      log(verbose, `  → direct-agent (attempt after ${numEditFailures} prior global failures)`)
      const direct = await runDirectAgent(brief, {
        verbose,
        maxIterations: opts.directAgentMaxIterations,
      })

      if (!direct.response.goal_achieved) {
        numEditFailures++
        recentFailureEvidence.push(
          `outcome_${i}: direct-agent reported goal_achieved=false — ` +
            `${direct.response.failure_reason_summary || direct.response.summary}`,
        )
        log(verbose, `  ✗ direct-agent failed; rollback (global failures=${numEditFailures})`)
        restoreScenarioTree(snap)
        dropScenarioTreeSnapshot(snap)
        if (numEditFailures > maxEditFailures) {
          failedOutcomes.push({
            test_spec_name: testSpecName,
            personas: outcome.personas,
            expected_survivors: outcome.expected_survivors,
            failure_reason_summary:
              `hit global edit-failure cap (${maxEditFailures}) while working on this outcome`,
          })
          break outer
        }
        continue
      }

      // Regression check: every previously-passing spec must still pass.
      let regressed = false
      for (const prev of passingSpecs) {
        const expected = expectedByName.get(prev)!
        log(verbose, `  ↻ regression: run_scenario_from_spec "${prev}"`)
        const res = await RUN_SCENARIO_FROM_SPEC_TOOL.run({
          scenario_id: scenarioId,
          test_spec_name: prev,
        })
        if ('error' in res) {
          recentFailureEvidence.push(
            `regression on "${prev}": run_scenario_from_spec errored — ${res.error}`,
          )
          regressed = true
          break
        }
        if (!res.complete) {
          recentFailureEvidence.push(
            `regression on "${prev}": run did not complete (timed out). ` +
              `summary=${res.scenario_summary}`,
          )
          regressed = true
          break
        }
        if (res.survivors !== expected) {
          recentFailureEvidence.push(
            `regression on "${prev}": expected ${expected} survivors, got ` +
              `${res.survivors}. summary=${res.scenario_summary}`,
          )
          regressed = true
          break
        }
      }

      if (regressed) {
        numEditFailures++
        log(verbose, `  ✗ regression detected; rollback (global failures=${numEditFailures})`)
        restoreScenarioTree(snap)
        dropScenarioTreeSnapshot(snap)
        if (numEditFailures > maxEditFailures) {
          failedOutcomes.push({
            test_spec_name: testSpecName,
            personas: outcome.personas,
            expected_survivors: outcome.expected_survivors,
            failure_reason_summary:
              `hit global edit-failure cap (${maxEditFailures}) after a ` +
              `regression caused by this outcome's edits`,
          })
          break outer
        }
        continue
      }

      // Clean pass for this outcome.
      passingSpecs.push(testSpecName)
      expectedByName.set(testSpecName, outcome.expected_survivors)
      dropScenarioTreeSnapshot(snap)
      log(verbose, `  ✓ outcome "${testSpecName}" passing`)
      break
    }
  }

  const goalAchieved = passingSpecs.length === plan.outcomes.length

  // Fill failed_outcomes with anything we didn't reach (only populated when
  // we break out early). Outcomes that were never attempted because we hit
  // the cap should also show up as failed.
  if (!goalAchieved && failedOutcomes.length > 0) {
    const attemptedIndex = plan.outcomes.findIndex(
      (_, i) => outcomeTestSpecName(i) === failedOutcomes[0].test_spec_name,
    )
    for (let i = attemptedIndex + 1; i < plan.outcomes.length; i++) {
      const o = plan.outcomes[i]
      failedOutcomes.push({
        test_spec_name: outcomeTestSpecName(i),
        personas: o.personas,
        expected_survivors: o.expected_survivors,
        failure_reason_summary: 'not attempted — run halted earlier',
      })
    }
  }

  return {
    goal_achieved: goalAchieved,
    plan_name: planId,
    scenario_id: scenarioId,
    passing_specs: passingSpecs,
    failed_outcomes: failedOutcomes,
    num_edit_failures: numEditFailures,
    failure_reason_summary: goalAchieved
      ? ''
      : `stopped after ${numEditFailures} edit failures with ` +
        `${passingSpecs.length}/${plan.outcomes.length} outcomes passing`,
  }
}
