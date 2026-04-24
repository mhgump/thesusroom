import fs from 'node:fs/promises'
import path from 'node:path'
import { CONTENT_DIR } from '../../paths.js'
import type {
  AgentConversation,
  AgentConversationTurn,
  DataBackend,
} from '../dataBackend.js'
import { FilesystemBotBackend } from './botBackend.js'
import { FilesystemMapBackend } from './mapBackend.js'
import { FilesystemScenarioBackend } from './scenarioBackend.js'
import { FilesystemScenarioRunResultBackend } from './scenarioRunResultBackend.js'
import { FilesystemTestSpecBackend } from './testSpecBackend.js'

export { FilesystemBotBackend } from './botBackend.js'
export { FilesystemMapBackend } from './mapBackend.js'
export { FilesystemScenarioBackend } from './scenarioBackend.js'
export { FilesystemScenarioRunResultBackend } from './scenarioRunResultBackend.js'
export { FilesystemTestSpecBackend } from './testSpecBackend.js'

const VETTED_SCENARIOS_PATH = path.join(CONTENT_DIR, 'vetted_scenarios.json')
const AGENT_CONVERSATIONS_PATH = path.join(CONTENT_DIR, 'agent_conversations.json')

export class FilesystemDataBackend implements DataBackend {
  bot = new FilesystemBotBackend()
  map = new FilesystemMapBackend()
  scenario = new FilesystemScenarioBackend()
  testSpec = new FilesystemTestSpecBackend()
  scenarioRunResult = new FilesystemScenarioRunResultBackend()

  addScenario(scenario_id: string): Promise<number> {
    return this.scenario.newScenario(scenario_id)
  }

  async deleteScenario(scenario_id: string): Promise<void> {
    await this.markScenarioUnvetted(scenario_id)
    await this.scenario.deleteScenario(scenario_id)
  }

  async markScenarioVetted(scenario_id: string): Promise<void> {
    const list = await readStringList(VETTED_SCENARIOS_PATH)
    if (list.includes(scenario_id)) return
    list.push(scenario_id)
    await writeStringList(VETTED_SCENARIOS_PATH, list)
  }

  async markScenarioUnvetted(scenario_id: string): Promise<void> {
    const list = await readStringList(VETTED_SCENARIOS_PATH)
    const idx = list.indexOf(scenario_id)
    if (idx === -1) return
    list.splice(idx, 1)
    await writeStringList(VETTED_SCENARIOS_PATH, list)
  }

  addTestSpec(scenario_id: string, test_spec_id: string): Promise<number> {
    return this.testSpec.newTestSpec(scenario_id, test_spec_id)
  }

  deleteTestSpec(scenario_id: string, test_spec_id: string): Promise<void> {
    return this.testSpec.deleteTestSpec(scenario_id, test_spec_id)
  }

  async addAgentConversationCost(
    conversation_id: string,
    turn: AgentConversationTurn,
  ): Promise<void> {
    const list = await readConversations()
    let conv = list.find(c => c.id === conversation_id)
    if (!conv) {
      conv = {
        id: conversation_id,
        turns: [],
        total_tokens: 0,
        total_in_tokens: 0,
        total_out_tokens: 0,
        total_cost: 0,
      }
      list.push(conv)
    }
    conv.turns.push(turn)
    conv.total_in_tokens += turn.in_tokens
    conv.total_out_tokens += turn.out_tokens
    conv.total_tokens = conv.total_in_tokens + conv.total_out_tokens
    conv.total_cost += turn.cost
    await writeConversations(list)
  }
}

async function readStringList(p: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(p, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error(`${p} must be a JSON array`)
    return parsed.filter((n): n is string => typeof n === 'string')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

async function writeStringList(p: string, list: string[]): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(list, null, 2) + '\n')
}

async function readConversations(): Promise<AgentConversation[]> {
  try {
    const raw = await fs.readFile(AGENT_CONVERSATIONS_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error(`${AGENT_CONVERSATIONS_PATH} must be a JSON array`)
    }
    return parsed as AgentConversation[]
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

async function writeConversations(list: AgentConversation[]): Promise<void> {
  await fs.mkdir(path.dirname(AGENT_CONVERSATIONS_PATH), { recursive: true })
  await fs.writeFile(AGENT_CONVERSATIONS_PATH, JSON.stringify(list, null, 2) + '\n')
}
