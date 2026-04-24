import type { BotSpec } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'
import { MovementIntent } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'

/**
 * IDLE_BOT — scenario4 fill persona.
 *
 * Auto-readies on connect and sits in place. Scenario4 currently has no
 * gameplay beyond room entry, so the bot just needs to connect so the fill
 * path can demonstrate the close-and-fill lifecycle.
 */
export const IDLE_BOT: BotSpec = {
  phases: ['idle'],
  initialState: {
    phase: 'idle',
    intent: MovementIntent.COMMIT,
    target: null,
  },
  onInstructMap: {},
  onOtherPlayerMove: {
    idle: () => {},
  },
  onActiveVoteAssignmentChange: {
    idle: () => {},
  },
  nextCommand: {
    idle: () => ({ type: 'idle' }),
  },
}

export default IDLE_BOT
