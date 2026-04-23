import { MovementIntent, moveToward } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'
import type { BotSpec } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'

const R2_TARGET = { type: 'circle' as const, x: 0, z: -12.5, radius: 2 }

export const DEMO_BOT: BotSpec = {
  phases: ['walk'],
  initialState: {
    phase: 'walk',
    intent: MovementIntent.COMMIT,
    target: null,
  },
  onInstructMap: {
    rule_move: (ctx) => {
      ctx.updateBotState({ target: R2_TARGET })
    },
  },
  onOtherPlayerMove: {
    walk: () => {},
  },
  onActiveVoteAssignmentChange: {
    walk: () => {},
  },
  nextAction: {
    walk: (ctx, position) => moveToward(position, ctx.state.target),
  },
}
