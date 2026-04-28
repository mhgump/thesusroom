// Thin wrapper around Anthropic's Vertex AI endpoint for claude-opus-4-7.
//
// The caller is expected to have already authenticated gcloud
// (`gcloud auth login` / `gcloud auth application-default login`). We shell out
// to `gcloud auth print-access-token` on every request so the access token
// stays fresh.

import { spawn, spawnSync } from 'node:child_process'
import type { ToolSpec } from '../tools/src/framework.js'

const MODEL_ID = 'claude-opus-4-7'
const API_VERSION = 'vertex-2023-10-16'
const LOCATION = 'global'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface AnthropicResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: ContentBlock[]
  stop_reason: 'tool_use' | 'end_turn' | 'stop_sequence' | 'max_tokens'
  usage?: { input_tokens: number; output_tokens: number }
}

export interface CreateMessageParams {
  system?: string
  messages: AnthropicMessage[]
  tools?: ToolSpec[]
  maxTokens?: number
}

async function getAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('gcloud', ['auth', 'print-access-token'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d.toString() })
    child.stderr.on('data', d => { err += d.toString() })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(
          `gcloud auth print-access-token exited ${code}: ${err.trim()}\n` +
          `Run \`gcloud auth login\` (or set a service account) before invoking agents.`,
        ))
      } else {
        resolve(out.trim())
      }
    })
  })
}

let cachedGcloudProject: string | null = null

function getProjectId(): string {
  const envId = process.env.VERTEX_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT
  if (envId) return envId

  if (cachedGcloudProject !== null) return cachedGcloudProject
  const res = spawnSync('gcloud', ['config', 'get-value', 'project'], {
    encoding: 'utf8',
  })
  const gcloudId = res.status === 0 ? res.stdout.trim() : ''
  if (gcloudId) {
    cachedGcloudProject = gcloudId
    return gcloudId
  }

  throw new Error(
    'Set VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT), or configure a default ' +
    'gcloud project (`gcloud config set project <id>`). The agent runtime ' +
    'uses this to build the Vertex AI endpoint URL.',
  )
}

export async function createMessage(params: CreateMessageParams): Promise<AnthropicResponse> {
  const token = await getAccessToken()
  const projectId = getProjectId()
  const url =
    `https://aiplatform.googleapis.com/v1/projects/${projectId}` +
    `/locations/${LOCATION}/publishers/anthropic/models/${MODEL_ID}:rawPredict`

  const body: Record<string, unknown> = {
    anthropic_version: API_VERSION,
    max_tokens: params.maxTokens ?? 4096,
    messages: params.messages,
  }
  // Put system prompt inside a content block so we can attach ephemeral cache
  // control to it — saves input tokens on multi-turn agent loops where the
  // system prompt is stable.
  if (params.system) {
    body.system = [
      { type: 'text', text: params.system, cache_control: { type: 'ephemeral' } },
    ]
  }
  if (params.tools) body.tools = params.tools

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Vertex AI ${res.status} ${res.statusText}: ${text}`)
  }
  return (await res.json()) as AnthropicResponse
}
