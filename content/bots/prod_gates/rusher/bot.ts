import type { BotSpec } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'
import {
  MovementIntent,
  moveToward,
} from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'

/**
 * RUSHER_BOT — prod_gates persona.
 *
 * World layout (computed from the map's computeRoomPositions; spawn at origin):
 *   spawn    : z ∈ (-0.125,  +0.125)
 *   corridor : z ∈ (-1.375,  -0.125)   (3 gates at z = +0.3125, 0, -0.3125)
 *   victory  : z ∈ (-1.625,  -1.375)
 *
 * Strategy: head straight north along x = 0 toward (0, -2.0). moveToward
 * drives the bot at every tick; when blocked by a closed gate the bot sits
 * pressed against the wall — which simultaneously puts it inside the
 * corresponding `btn_open_N` trigger radius. The button fires (see
 * scenario.ts), the gate drops, and the bot resumes northward on the next
 * tick. Once z < VICTORY_Z (inside the victory room) the bot idles.
 *
 * Auto-readies on connect (BotClient default).
 */

const VICTORY_Z = -1.375
const TARGET = { type: 'circle' as const, x: 0, z: -2.0, radius: 0.05 }

export const RUSHER_BOT: BotSpec = {
  phases: ['rush', 'done'],
  initialState: {
    phase: 'rush',
    intent: MovementIntent.COMMIT,
    target: TARGET,
  },
  onInstructMap: {},
  onOtherPlayerMove: {
    rush: () => {},
    done: () => {},
  },
  onActiveVoteAssignmentChange: {
    rush: () => {},
    done: () => {},
  },
  nextCommand: {
    rush: (ctx, position) => {
      if (position.z < VICTORY_Z) {
        ctx.updateBotState({ phase: 'done', target: null })
        return { type: 'idle' }
      }
      return moveToward(position, TARGET)
    },
    done: () => ({ type: 'idle' }),
  },
}

export default RUSHER_BOT
