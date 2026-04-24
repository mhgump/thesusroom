import type { BotSpec } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'
import {
  MovementIntent,
  moveToward,
} from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'

/**
 * RUSHER_BOT — prod_gates persona.
 *
 * The map is a vertical corridor: spawn at +z (south), victory at z < -0.40
 * (north). Three gates sit at x=0, z = +0.35, +0.10, -0.15 with a 0.1-wide
 * gap centered on x=0. Gates open automatically via proximity from the
 * scenario script — no button press needed.
 *
 * Strategy: set a fixed target at (x=0, z=-0.5) — past the victory
 * threshold and aligned with all three gate gaps. moveToward will push
 * straight north along x=0, threading every gate. Once the bot crosses
 * z < -0.40 it switches to the `done` phase and idles.
 *
 * Auto-readies on connect (BotClient default).
 */

const VICTORY_Z = -0.4
const TARGET = { type: 'circle' as const, x: 0, z: -0.5, radius: 0.05 }

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
