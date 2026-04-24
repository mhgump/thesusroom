import type { BotSpec } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'
import { MovementIntent } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'

/**
 * IDLE_BOT — scenario1 fill persona.
 *
 * Auto-readies on connect. Stays in place forever; never votes, never moves.
 * Used by the close-and-fill lifecycle to pad the room up to MIN_PLAYERS when
 * the 10s fill timer fires. The scenario's vote-convergence terminal path
 * cannot fire with idle fill, so scenario1 schedules a fallback terminate
 * after the fill — see content/scenarios/scenario1/scenario.ts.
 */
export const IDLE_BOT: BotSpec = {
  phases: ['idle'],
  initialState: {
    phase: 'idle',
    intent: MovementIntent.COMMIT,
    target: null,
  },
  onInstructMap: {
    find_instruction: () => {},
    vote_instruction: () => {},
  },
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
