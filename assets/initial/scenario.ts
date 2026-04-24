import type { ScenarioSpec } from '../../react-three-capacitor/server/src/ContentRegistry.js'
import type { GameScript } from '../../react-three-capacitor/server/src/GameScript.js'

interface InitialState {
  closed: boolean
}

// Solo-room scenario: each `/` client gets its own MultiplayerRoom. Closing
// the scenario on first connect removes the room from the router's open-room
// pool, so the next connect creates a fresh room — one player per room.
const script: GameScript<InitialState> = {
  initialState: () => ({ closed: false }),

  onPlayerConnect(state, ctx) {
    if (state.closed) return
    state.closed = true
    ctx.closeScenario()
  },
}

export const SCENARIO: ScenarioSpec = {
  id: 'initial',
  timeoutMs: 60_000,
  maxPlayers: 1,
  script,
  // Hall is 0.25×1.5 at the world origin (south wall at z = +0.75). Spawn
  // 0.25 units above (north of) that wall — player lands in the lower third
  // of the corridor facing upward.
  spawn: { x: 0, z: 0.5 },
}
