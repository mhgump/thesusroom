import type { Backends } from './backends.js'
import type { DataBackend } from './dataBackend.js'
import { FilesystemBackends, FilesystemDataBackend } from './filesystem/index.js'
import { PostgresDataBackend } from './postgres/dataBackend.js'

let cachedBackends: Backends | null = null
let cachedDataBackend: DataBackend | null = null

export function getBackends(): Backends {
  if (cachedBackends) return cachedBackends
  const kind = process.env.DATA_BACKEND ?? 'filesystem'
  switch (kind) {
    case 'filesystem': {
      cachedBackends = new FilesystemBackends()
      return cachedBackends
    }
    case 'postgres':
      throw new Error('DATA_BACKEND=postgres not implemented for per-content-type backends')
    default:
      throw new Error(`unknown DATA_BACKEND: ${kind}`)
  }
}

export function getDataBackend(): DataBackend {
  if (cachedDataBackend) return cachedDataBackend
  const kind = process.env.DATA_BACKEND ?? 'filesystem'
  switch (kind) {
    case 'filesystem': {
      cachedDataBackend = new FilesystemDataBackend()
      return cachedDataBackend
    }
    case 'postgres': {
      cachedDataBackend = new PostgresDataBackend()
      return cachedDataBackend
    }
    default:
      throw new Error(`unknown DATA_BACKEND: ${kind}`)
  }
}

export * from './types.js'
export * from './keyValueBackend.js'
export * from './dataBackend.js'
export * from './backends.js'
export { ScenarioList } from './ops/scenarioList.js'
export { VettedScenarios } from './ops/vettedScenarios.js'
export { TestSpecList } from './ops/testSpecList.js'
export {
  AgentConversations,
  type AgentConversation,
  type AgentConversationTurn,
} from './ops/agentConversations.js'
export { PlayerRegistry } from './ops/playerRegistry.js'
export {
  PlayerRecordings,
  type PlayerRecordingDoc,
  type RecordingEvent,
} from './ops/playerRecordings.js'
