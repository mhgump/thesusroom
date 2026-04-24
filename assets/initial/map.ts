import type { GameMap } from '../../react-three-capacitor/src/game/GameMap.js'
import type { RoomSpec } from '../../react-three-capacitor/src/game/RoomSpec.js'
import {
  computeRoomPositions,
  validateWorldSpec,
} from '../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../react-three-capacitor/src/game/CameraConstraint.js'

const MAP_INSTANCE_ID = 'initial'

const bt = 0.025
const bh = 0.025
const BY = bh / 2
const HALL_W = 0.25
const HALL_D = 1.5
const ROOM_H = 0.5

const HD_Z     = HALL_D / 2
const HD_X     = HALL_W / 2
const WALL_CZ  = HD_Z - bt / 2
const WALL_CX  = HD_X - bt / 2
// E/W walls run the full room depth so they own all four corners. N/S
// walls sit between them as door segments that drop at each loop seam —
// when the north wall of the source and the south wall of the next
// hallway both drop, the corridor's side walls stay continuous across
// the join.
const NS_WALL_W = HALL_W - 2 * bt

const ROOMS: RoomSpec[] = [
  {
    id: 'hall', name: 'Initial',
    floorWidth: HALL_W,
    floorDepth: HALL_D,
    height: ROOM_H,
    cameraRect: { xMin: -HD_X, xMax: HD_X, zMin: -HD_Z, zMax: HD_Z },
    geometry: [
      { id: 'initial_wn', cx: 0,        cy: BY, cz: -WALL_CZ, width: NS_WALL_W, height: bh, depth: bt },
      { id: 'initial_ws', cx: 0,        cy: BY, cz:  WALL_CZ, width: NS_WALL_W, height: bh, depth: bt },
      { id: 'initial_we', cx:  WALL_CX, cy: BY, cz: 0,        width: bt,        height: bh, depth: HALL_D },
      { id: 'initial_ww', cx: -WALL_CX, cy: BY, cz: 0,        width: bt,        height: bh, depth: HALL_D },
    ],
  },
]

const TOPOLOGY = { rooms: ROOMS, connections: [] }
const LOCAL_POSITIONS = computeRoomPositions(TOPOLOGY)
validateWorldSpec(TOPOLOGY, LOCAL_POSITIONS)
const ARTIFACTS = buildMapInstanceArtifacts(TOPOLOGY, MAP_INSTANCE_ID)
const CAMERA_SHAPES = buildCameraConstraintShapes(TOPOLOGY, LOCAL_POSITIONS)

export const MAP: GameMap = {
  id: 'initial',
  mapInstanceId: MAP_INSTANCE_ID,
  rooms: ROOMS,
  connections: [],
  roomPositions: ARTIFACTS.roomPositions,
  cameraShapes: CAMERA_SHAPES,
  instructionSpecs: [],
  voteRegions: [],
  npcs: [],
  getRoomAtPosition: ARTIFACTS.getRoomAtPosition,
  getAdjacentRoomIds: ARTIFACTS.getAdjacentRoomIds,
  isRoomOverlapping: ARTIFACTS.isRoomOverlapping,
}
