import type { BotSpec } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'
import { MovementIntent } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'

/**
 * IDLER_BOT — prod_gates "do nothing" persona.
 *
 * Auto-readies on connect (default BotClient behavior). Never moves, never
 * presses abilities, never disconnects. Stays at its spawn point in band1
 * for the full scenario duration; expected outcome is elimination when the
 * 30-second timer expires.
 *
 * Implementation is intentionally minimal: a single 'idle' phase whose
 * nextCommand always returns { type: 'idle' }. Empty handler maps for
 * instructions, other-player moves, and vote-assignment changes ensure the
 * bot is a complete no-op regardless of what the scenario broadcasts.
 */
export const IDLER_BOT: BotSpec = {
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

export default IDLER_BOT
