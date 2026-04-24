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

export { ToolRegistry } from './framework.js'
export type { Tool, ToolSpec, JsonSchemaObject } from './framework.js'
export * from './runScenario/index.js'

// The canonical list of tools exposed to agent loops. Add new tools here.
export const ALL_TOOLS: Tool[] = [
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
