import type { BotSpec } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js';
import {
  MovementIntent,
  moveToward,
} from '../../../../react-three-capacitor/server/src/bot/BotTypes.js';

/**
 * MOVER_BOT — scenario2 persona.
 *
 * Behavior: Auto-readies on connect (via autoReady). Idles in place until the
 * `rule_move` instruction fires (door opens). Then walks north through the
 * open door into room2 (center ≈ x=0, z=-0.75) and stays there.
 */
export const MOVER_BOT: BotSpec = {
  phases: ['walk'],
  initialState: {
    phase: 'walk',
    intent: MovementIntent.COMMIT,
    target: null,
  },
  onInstructMap: {
    rule_move: (ctx) => {
      ctx.updateBotState({
        target: { type: 'circle', x: 0, z: -0.75, radius: 0.1 },
      })
    },
    fact_1: () => {},
    fact_2: () => {},
    fact_3: () => {},
    fact_4: () => {},
  },
  onOtherPlayerMove: {
    walk: () => {},
  },
  onActiveVoteAssignmentChange: {
    walk: () => {},
  },
  nextCommand: {
    walk: (ctx, position) => moveToward(position, ctx.state.target),
  },
}

export default MOVER_BOT;
