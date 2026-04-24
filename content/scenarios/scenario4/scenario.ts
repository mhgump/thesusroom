import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type { GameScript } from '../../../react-three-capacitor/server/src/GameScript.js'

const script: GameScript<Record<string, never>> = {
  initialState: () => ({}),
}

export const SCENARIO: ScenarioSpec = {
  id: 'scenario4',
  timeoutMs: 60_000,
  maxPlayers: 4,
  script,
  hubConnection: {
    mainRoomId: 'south_hall',
    dockGeometryId: 's4_s_s',
  },
}
