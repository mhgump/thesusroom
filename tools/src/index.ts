// Public entry point for the agent tools catalogue.
//
//   import { buildToolRegistry, getToolSpecs, callTool } from '../tools/src/index.js'
//
//   // Pass specs into your LLM call:
//   const specs = getToolSpecs()
//
//   // When the model emits a tool_use, dispatch:
//   const result = await callTool(name, input)

import { ToolRegistry, type Tool, type ToolSpec } from './framework.js'
import { RUN_SCENARIO_TOOL } from './runScenario/index.js'
import { INSERT_MAP_TOOL } from './insertMap/index.js'
import { INSERT_SCENARIO_TOOL } from './insertScenario/index.js'
import { INSERT_BOT_TOOL } from './insertBot/index.js'
import { INSERT_SCENARIO_PLAN_TOOL } from './insertScenarioPlan/index.js'
import { RUN_SCENARIO_WITH_BOTS_TOOL } from './runScenarioWithBots/index.js'
import { GET_SCENARIO_LOGS_TOOL } from './getScenarioLogs/index.js'
import { GET_BOT_LOGS_TOOL } from './getBotLogs/index.js'
import { INSERT_RUN_SCENARIO_SPEC_TOOL } from './insertRunScenarioSpec/index.js'
import { RUN_SCENARIO_FROM_SPEC_TOOL } from './runScenarioFromSpec/index.js'
import { ADD_NOTES_TO_TEST_SPEC_TOOL } from './addNotesToTestSpec/index.js'
import { READ_TEST_SPEC_TOOL } from './readTestSpec/index.js'
import { LIST_CONTENT_TOOL } from './listContent/index.js'
import { MAP_AGENT_TOOL } from './mapAgentTool/index.js'
import { SCENARIO_AGENT_TOOL } from './scenarioAgentTool/index.js'
import { BOT_AGENT_TOOL } from './botAgentTool/index.js'
import { RUN_SCENARIO_AGENT_TOOL } from './runScenarioAgentTool/index.js'
import { SCENARIO_PLAN_AGENT_TOOL } from './scenarioPlanAgentTool/index.js'
import { DIRECT_AGENT_TOOL } from './directAgentTool/index.js'
import { LOAD_SCENARIO_CONTEXT_TOOL } from './loadScenarioContext/index.js'

export { ToolRegistry } from './framework.js'
export type { Tool, ToolSpec, JsonSchemaObject } from './framework.js'
export * from './runScenario/index.js'
export * from './insertMap/index.js'
export * from './insertScenario/index.js'
export * from './insertBot/index.js'
export * from './insertScenarioPlan/index.js'
export * from './runScenarioWithBots/index.js'
export * from './getScenarioLogs/index.js'
export * from './getBotLogs/index.js'
export * from './insertRunScenarioSpec/index.js'
export * from './runScenarioFromSpec/index.js'
export * from './addNotesToTestSpec/index.js'
export * from './readTestSpec/index.js'
export * from './listContent/index.js'
export type {
  RunScenarioSpec,
  RunScenarioSpecBot,
  RunScenarioSpecNote,
  RunScenarioSpecOpts,
} from '../../shared/runScenarioSpec.js'
export * from './mapAgentTool/index.js'
export * from './scenarioAgentTool/index.js'
export * from './botAgentTool/index.js'
export * from './runScenarioAgentTool/index.js'
export * from './scenarioPlanAgentTool/index.js'
export * from './directAgentTool/index.js'
export * from './loadScenarioContext/index.js'

// Agent runners (for direct programmatic use alongside the CLI scripts).
export { runMapAgent, MAP_RESPONSE_SPEC } from './agents/mapAgent.js'
export type { MapAgentResponse } from './agents/mapAgent.js'
export { runScenarioAgent, SCENARIO_RESPONSE_SPEC } from './agents/scenarioAgent.js'
export type { ScenarioAgentResponse } from './agents/scenarioAgent.js'
export { runBotAgent, BOT_RESPONSE_SPEC } from './agents/botAgent.js'
export type { BotAgentResponse } from './agents/botAgent.js'
export { runRunScenarioAgent, RUN_SCENARIO_RESPONSE_SPEC } from './agents/runScenarioAgent.js'
export type { RunScenarioAgentResponse } from './agents/runScenarioAgent.js'
export { runDirectAgent, DIRECT_RESPONSE_SPEC } from './agents/directAgent.js'
export type { DirectAgentResponse } from './agents/directAgent.js'
export { runScenarioPlanAgent, SCENARIO_PLAN_RESPONSE_SPEC } from './agents/scenarioPlanAgent.js'
export type { ScenarioPlanAgentResponse } from './agents/scenarioPlanAgent.js'
export { runCreateScenarioAgent, CREATE_SCENARIO_RESPONSE_SPEC } from './agents/createScenarioAgent.js'
export type {
  CreateScenarioAgentResponse,
  CreateScenarioAgentOpts,
  CreateScenarioFailedOutcome,
} from './agents/createScenarioAgent.js'

export { runAgent, RECORD_TOOL_NAME } from '../../shared/agentLoop.js'
export type { AgentRunParams, AgentRunResult, ResponseSpec } from '../../shared/agentLoop.js'

// The canonical list of tools exposed to agent loops. Add new tools here.
export const ALL_TOOLS: Tool[] = [
  // Sub-agents (callable from higher-level agents such as the direct agent).
  SCENARIO_PLAN_AGENT_TOOL as Tool,
  MAP_AGENT_TOOL as Tool,
  SCENARIO_AGENT_TOOL as Tool,
  BOT_AGENT_TOOL as Tool,
  DIRECT_AGENT_TOOL as Tool,
  RUN_SCENARIO_AGENT_TOOL as Tool,
  // Context loading.
  LOAD_SCENARIO_CONTEXT_TOOL as Tool,
  // Low-level primitives.
  INSERT_MAP_TOOL as Tool,
  INSERT_SCENARIO_TOOL as Tool,
  INSERT_BOT_TOOL as Tool,
  INSERT_SCENARIO_PLAN_TOOL as Tool,
  RUN_SCENARIO_WITH_BOTS_TOOL as Tool,
  GET_SCENARIO_LOGS_TOOL as Tool,
  GET_BOT_LOGS_TOOL as Tool,
  // Test-spec lifecycle (persisted under content/scenarios/{scenario_id}/test_specs/).
  INSERT_RUN_SCENARIO_SPEC_TOOL as Tool,
  RUN_SCENARIO_FROM_SPEC_TOOL as Tool,
  ADD_NOTES_TO_TEST_SPEC_TOOL as Tool,
  READ_TEST_SPEC_TOOL as Tool,
  LIST_CONTENT_TOOL as Tool,
  // Kept for callers that want full control of run-scenario plumbing.
  RUN_SCENARIO_TOOL as Tool,
]

export function buildToolRegistry(): ToolRegistry {
  const reg = new ToolRegistry()
  for (const t of ALL_TOOLS) reg.register(t)
  return reg
}

// Default shared registry — convenient for simple agent loops that just want
// to grab specs + invoke tools without threading a registry through.
const defaultRegistry = buildToolRegistry()

export function getToolSpecs(): ToolSpec[] {
  return defaultRegistry.getSpecs()
}

export async function callTool(name: string, input: unknown): Promise<unknown> {
  return defaultRegistry.call(name, input)
}
