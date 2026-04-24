import type { BotSpec } from '../../../../react-three-capacitor/server/src/bot/BotTypes';
import { MovementIntent } from '../../../../react-three-capacitor/server/src/bot/BotTypes';

/**
 * STAYER_BOT — scenario2 persona.
 *
 * Marks ready on join (handled automatically via autoReady) and then
 * ignores the rule_move instruction, remaining in room1 until eliminated.
 * Always idles; never issues a move command.
 */
export const STAYER_BOT: BotSpec = {
  phases: ['idle'],
  initialState: {
    phase: 'idle',
    intent: MovementIntent.COMMIT,
    target: null,
  },
  onInstructMap: {
    // Intentionally ignore the rule_move instruction — the stayer never moves.
    rule_move: (_ctx) => {
      // no-op
    },
  },
  onOtherPlayerMove: {
    idle: (_ctx) => {
      // no-op
    },
  },
  onActiveVoteAssignmentChange: {
    idle: (_ctx) => {
      // no-op
    },
  },
  nextCommand: {
    idle: (_ctx) => ({ type: 'idle' }),
  },
};

export default STAYER_BOT;
