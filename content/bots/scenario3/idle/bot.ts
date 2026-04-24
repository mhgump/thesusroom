import type { BotSpec } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'
import { MovementIntent } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'

/**
 * IDLE_BOT — scenario3 fill persona.
 *
 * Auto-readies on connect. Stays in place forever; never presses buttons,
 * never enters the vote zone. Used by the close-and-fill lifecycle to pad
 * the room up to MIN_PLAYERS when the 10s fill timer fires.
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
