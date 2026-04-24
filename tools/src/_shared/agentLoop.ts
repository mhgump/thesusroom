// Tool-use agent loop.
//
// Each agent is given a set of Tool instances plus an implicit
// `record_json_task_response` tool whose input_schema describes the exact
// payload the caller wants back. The loop:
//
//   1. Calls the model with the current messages + tools.
//   2. If the response contains a `record_json_task_response` tool call, the
//      input is captured as the final response and the loop exits.
//   3. Otherwise each tool_use is dispatched to its Tool; the results are
//      appended as tool_result blocks and the loop continues.
//
// The record tool's schema is surfaced as the return-value spec so the model
// knows what to produce; its implementation simply records whatever is passed.
// (Agents cannot emit free text as a final answer — they must call record.)

import type { JsonSchemaObject, Tool, ToolSpec } from '../framework.js'
import {
  createMessage,
  type AnthropicMessage,
  type ContentBlock,
} from './anthropic.js'

export const RECORD_TOOL_NAME = 'record_json_task_response'

export interface ResponseSpec {
  // Human-readable description prepended to the record tool description.
  description: string
  // JSON schema for the expected response. Used as the record tool's input_schema.
  schema: JsonSchemaObject
}

export interface AgentRunParams {
  systemPrompt: string
  userPrompt: string
  tools: Tool[]
  responseSpec: ResponseSpec
  maxIterations?: number
  // Write transcript-style progress to stderr. Useful in CLI runners.
  verbose?: boolean
}

export interface AgentRunResult<T = unknown> {
  response: T
  iterations: number
  transcript: AnthropicMessage[]
}

function buildRecordSpec(spec: ResponseSpec): ToolSpec {
  return {
    name: RECORD_TOOL_NAME,
    description:
      `Record your final JSON response to end the task. This tool accepts any ` +
      `input — use it exactly once when you are done, with the payload matching ` +
      `the schema below.\n\nExpected payload: ${spec.description}`,
    input_schema: spec.schema,
  }
}

function logIf(verbose: boolean | undefined, msg: string): void {
  if (verbose) process.stderr.write(`[agent] ${msg}\n`)
}

export async function runAgent<T = unknown>(
  params: AgentRunParams,
): Promise<AgentRunResult<T>> {
  const toolByName = new Map<string, Tool>()
  for (const t of params.tools) toolByName.set(t.spec.name, t)

  const recordSpec = buildRecordSpec(params.responseSpec)
  const allSpecs: ToolSpec[] = [...params.tools.map(t => t.spec), recordSpec]

  const messages: AnthropicMessage[] = [
    { role: 'user', content: params.userPrompt },
  ]

  const maxIterations = params.maxIterations ?? 30
  let iterations = 0

  while (iterations < maxIterations) {
    iterations++
    logIf(params.verbose, `iteration ${iterations} — calling model`)

    const res = await createMessage({
      system: params.systemPrompt,
      messages,
      tools: allSpecs,
    })

    messages.push({ role: 'assistant', content: res.content })

    // Accumulate tool_result blocks; we reply with one user message containing
    // all of them (Anthropic requires one tool_result per tool_use).
    const toolUses = res.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    )

    if (toolUses.length === 0) {
      // Model produced only text. Nudge it to call record.
      messages.push({
        role: 'user',
        content:
          `You must finish by calling ${RECORD_TOOL_NAME} with your final JSON ` +
          `response. Do not emit text-only turns.`,
      })
      continue
    }

    const results: Array<Extract<ContentBlock, { type: 'tool_result' }>> = []
    for (const tu of toolUses) {
      if (tu.name === RECORD_TOOL_NAME) {
        logIf(params.verbose, `record_json_task_response called — done`)
        return { response: tu.input as T, iterations, transcript: messages }
      }
      const tool = toolByName.get(tu.name)
      if (!tool) {
        logIf(params.verbose, `unknown tool: ${tu.name}`)
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `Unknown tool: ${tu.name}`,
          is_error: true,
        })
        continue
      }
      try {
        logIf(params.verbose, `→ ${tu.name}`)
        const out = await tool.run(tu.input)
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: typeof out === 'string' ? out : JSON.stringify(out),
        })
      } catch (err) {
        const msg = (err as Error).message ?? String(err)
        logIf(params.verbose, `✗ ${tu.name}: ${msg}`)
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: msg,
          is_error: true,
        })
      }
    }

    messages.push({ role: 'user', content: results })
  }

  throw new Error(
    `Agent did not call ${RECORD_TOOL_NAME} within ${maxIterations} iterations.`,
  )
}
