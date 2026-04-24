import type { BotSpec } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'
import {
  MovementIntent,
  moveToward,
} from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'

/**
 * RUSHER_BOT — prod_gates persona.
 *
 * World layout (computeRoomPositions; spawn at origin; corridor center z = -0.75):
 *   spawn    : z ∈ (-0.125,  +0.125)
 *   corridor : z ∈ (-1.375,  -0.125)   (3 gates at world z = -0.4375, -0.75, -1.0625)
 *   victory  : z ∈ (-1.625,  -1.375)
 *
 * Strategy: head straight north along x = 0 toward (0, -2.0). Each tick the
 * bot also fires the scenario's OPEN ability — the scenario's handler
 * picks the nearest closed gate within range of the caller and only fires
 * once per gate, so spamming the ability is safe. When the bot is inside
 * the victory room it idles and stops using OPEN.
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
      // Fire OPEN every time nextCommand runs (~4 Hz). The scenario drops a
      // gate only if we're physically close enough — early spam from the
      // spawn room is ignored server-side.
      ctx.useAbility('open')
      return moveToward(position, TARGET)
    },
    done: () => ({ type: 'idle' }),
  },
}

export default RUSHER_BOT
