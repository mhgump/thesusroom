import type { DataBackend } from '../dataBackend.js'

const KEY = 'agent_conversations'

export interface AgentConversationTurn {
  in_tokens: number
  out_tokens: number
  cost: number
}

export interface AgentConversation {
  id: string
  turns: AgentConversationTurn[]
  total_tokens: number
  total_in_tokens: number
  total_out_tokens: number
  total_cost: number
}

export class AgentConversations {
  constructor(private readonly data: DataBackend) {}

  // Append a turn to the named conversation, creating it if needed, and
  // recompute its running totals. Identity is by conversation id — position
  // in the underlying list is not stable.
  async addAgentConversationCost(
    conversation_id: string,
    turn: AgentConversationTurn,
  ): Promise<void> {
    const list = await this.data.readList<AgentConversation>(KEY)
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
    await this.data.writeList(KEY, list)
  }
}
