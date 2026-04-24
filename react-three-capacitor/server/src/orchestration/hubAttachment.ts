import type { GameMap } from '../../../src/game/GameMap.js'
import type { RoomWorldPos } from '../../../src/game/WorldSpec.js'
import { computeRoomPositions, scopedRoomId } from '../../../src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../src/game/CameraConstraint.js'
import type { Wall } from '../../../src/game/RoomSpec.js'
import type { ScenarioSpec } from '../ContentRegistry.js'

export interface HubAttachment {
  // World-space origin at which the initial hallway map should be placed so
  // its opposing wall face meets the target room's chosen wall face at the
  // same world coordinate.
  hallwayOrigin: RoomWorldPos
  // The hallway-side wall geometry id to drop on reveal. Derived from the
  // target's `wallSide` (opposite cardinal).
  initialWallIdToDrop: string
  // The target-side wall geometry id to drop on reveal. Copied verbatim
  // from `hubConnection.wallGeometryId`.
  targetWallIdToDrop: string
  // The two scoped room ids whose adjacency should be enabled on reveal:
  // the initial hallway room and the target's main room. Symmetric.
  crossInstanceEdge: { a: string; b: string }
}

// The initial hallway is authored with a single room `hall` whose north wall
// is `initial_wn`, south is `initial_ws`, east is `initial_we`, west is
// `initial_ww`. `HALLWAY_DOCK_WALL_FOR_TARGET_SIDE` is keyed by the TARGET
// room's wallSide and returns the hallway wall that docks against it — the
// cardinally-opposite side. For target='south', the hallway's north face
// meets it (drop `initial_wn`); for target='north', the hallway's south
// face meets it (drop `initial_ws`), and so on.
const HALLWAY_DOCK_WALL_FOR_TARGET_SIDE: Record<Wall, string> = {
  south: 'initial_wn',
  north: 'initial_ws',
  west:  'initial_we',
  east:  'initial_ww',
}

// Compute where to place the initial hallway (in the target map's world
// frame) so its opposing-wall face meets the target room's chosen wall face,
// and the scoped adjacency edge that connects them. Drives the hub transfer
// flow: the orchestration places the hallway with this origin, toggles the
// two returned wall geometries off, and enables the returned adjacency edge.
//
// First pass supports `wallSide === 'south'` only (target's southern wall).
// Extending to the other sides is straightforward rotational math; deferred
// until a scenario actually needs it.
export function computeHubAttachment(
  initialMap: GameMap,
  targetMap: GameMap,
  scenario: ScenarioSpec,
): HubAttachment {
  const hub = scenario.hubConnection
  if (!hub) {
    throw new Error(`computeHubAttachment: scenario '${scenario.id}' has no hubConnection`)
  }
  if (hub.wallSide !== 'south') {
    throw new Error(
      `computeHubAttachment: wallSide '${hub.wallSide}' is not implemented yet ` +
      `(first pass only supports 'south'). Scenario: ${scenario.id}`,
    )
  }

  const hallwayRoom = initialMap.rooms[0]
  if (!hallwayRoom) throw new Error('computeHubAttachment: initial map has no rooms')

  const targetPositions = computeRoomPositions(targetMap)
  const mainRoom = targetMap.rooms.find(r => r.id === hub.mainRoomId)
  const mainRoomPos = targetPositions.get(hub.mainRoomId)
  if (!mainRoom || !mainRoomPos) {
    throw new Error(
      `computeHubAttachment: target map '${targetMap.mapInstanceId}' has no room '${hub.mainRoomId}'`,
    )
  }

  // Target main room's south wall face (world z = local cz + floorDepth/2,
  // since the target is placed at its own authored origin).
  const targetOrigin = targetMap.origin ?? { x: 0, z: 0 }
  const targetSouthFaceWorldZ = targetOrigin.z + mainRoomPos.z + mainRoom.floorDepth / 2

  // Initial hallway's north wall face in hallway-local coords:
  //   local cz = -floorDepth/2
  const hallwayNorthFaceLocalZ = -hallwayRoom.floorDepth / 2

  // Solve for hallwayOrigin.z such that the two faces meet:
  //   hallwayOrigin.z + hallwayNorthFaceLocalZ = targetSouthFaceWorldZ
  const hallwayOriginZ = targetSouthFaceWorldZ - hallwayNorthFaceLocalZ

  // x-offset: centre the hallway on the wall at positionOnWall, accounting
  // for the hallway being narrower/wider than the main room's wall span.
  const targetMainRoomWorldX = targetOrigin.x + mainRoomPos.x
  const hallwayOriginX =
    targetMainRoomWorldX +
    (hub.positionOnWall - 0.5) * (mainRoom.floorWidth - hallwayRoom.floorWidth)

  const initialWallIdToDrop = HALLWAY_DOCK_WALL_FOR_TARGET_SIDE[hub.wallSide]

  return {
    hallwayOrigin: { x: hallwayOriginX, z: hallwayOriginZ },
    initialWallIdToDrop,
    targetWallIdToDrop: hub.wallGeometryId,
    crossInstanceEdge: {
      a: scopedRoomId(initialMap.mapInstanceId, hallwayRoom.id),
      b: scopedRoomId(targetMap.mapInstanceId, hub.mainRoomId),
    },
  }
}

// Build a shifted GameMap at the computed origin. The world's `addMap` calls
// `buildMapInstanceArtifacts` off `map.origin`, so we need to clone the map
// with the new origin and recompute the derived artifacts so the returned
// GameMap value is self-consistent (the `addMap` path reads origin via
// `computeRoomPositions`, but scenarios that inspect the map's
// `roomPositions` / `cameraShapes` expect those to match).
export function shiftMapToOrigin(map: GameMap, origin: RoomWorldPos): GameMap {
  const topology = { rooms: map.rooms, connections: map.connections, origin }
  const localPositions = computeRoomPositions(topology)
  const artifacts = buildMapInstanceArtifacts(topology, map.mapInstanceId)
  const cameraShapes = buildCameraConstraintShapes(topology, localPositions)
  return {
    ...map,
    origin,
    roomPositions: artifacts.roomPositions,
    cameraShapes,
    getRoomAtPosition: artifacts.getRoomAtPosition,
    getAdjacentRoomIds: artifacts.getAdjacentRoomIds,
    isRoomOverlapping: artifacts.isRoomOverlapping,
  }
}
