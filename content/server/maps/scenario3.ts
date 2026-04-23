import type { MapSpec } from '../../../react-three-capacitor/server/src/ScenarioRegistry.js'

const R = 0.0282
const ROOM_SIZE = 0.9672

const BTN_Z = 0
const BTN_LEFT_X = -0.2014
const BTN_RIGHT_X = 0.2014
const BTN_TRIGGER_R = 0.0645

export const SCENARIO3_MAP: MapSpec = {
  id: 'scenario3',
  walkable: {
    rects: [{ cx: 0, cz: 0, hw: ROOM_SIZE / 2 - R, hd: ROOM_SIZE / 2 - R }],
  },
  npcs: [],
  voteRegions: [
    // Invisible tracking region co-located with the right button trigger area.
    // Used by the script to count occupants and toggle enableClientPress.
    { id: 's3_rzone', label: '', color: 'transparent', x: BTN_RIGHT_X, z: BTN_Z, radius: BTN_TRIGGER_R },
  ],
  buttons: [
    {
      id: 'btn_left',
      x: BTN_LEFT_X,
      z: BTN_Z,
      triggerRadius: BTN_TRIGGER_R,
      platformRadius: 0.0483,
      ringOuterRadius: 0.0531,  // platformRadius * 1.1
      ringInnerRadius: 0.0483,
      raisedHeight: 0.0145,
      color: '#c0392b',
      ringColor: '#e74c3c',
      // Resets as soon as player leaves; always immediately pressable.
      requiredPlayers: 1,
      holdAfterRelease: false,
      cooldownMs: 0,
      enableClientPress: true,
    },
    {
      id: 'btn_right',
      x: BTN_RIGHT_X,
      z: BTN_Z,
      triggerRadius: BTN_TRIGGER_R,
      platformRadius: 0.0483,
      ringOuterRadius: 0.0531,  // platformRadius * 1.1
      ringInnerRadius: 0.0483,
      raisedHeight: 0.0145,
      color: '#1a5276',
      ringColor: '#2980b9',
      // Requires 2 players to actually press; enableClientPress toggled by script.
      requiredPlayers: 2,
      holdAfterRelease: false,
      cooldownMs: 0,
      enableClientPress: false,
    },
  ],
}
