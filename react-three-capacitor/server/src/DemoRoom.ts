import { Room } from './Room.js';

/**
 * Demo room with two test rounds:
 *  Round 0 — empty scene, player has SKIP
 *  Round 1 — SKIP removed (player has no actions)
 *
 * SKIP advances to the next round; after the last round the room loops back.
 */
export class DemoRoom extends Room {
  constructor(roomId: string) {
    super(roomId);
    this.rounds = [
      { id: 0, availableActions: ['SKIP'] },
      { id: 1, availableActions: [] },
    ];
  }

  onAction(playerId: string, action: string): void {
    if (action === 'SKIP') {
      this.nextRound();
    }
  }
}
