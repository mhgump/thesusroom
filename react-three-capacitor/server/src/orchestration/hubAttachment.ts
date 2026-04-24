import type { GameMap } from '../../../src/game/GameMap.js'
import type { RoomWorldPos } from '../../../src/game/WorldSpec.js'
import { computeRoomPositions, scopedRoomId } from '../../../src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../src/game/CameraConstraint.js'
import type { GeometrySpec, RoomSpec } from '../../../src/game/RoomSpec.js'
import type { ScenarioSpec } from '../ContentRegistry.js'

export interface HubAttachment {
  // World-space origin at which the initial hallway map should be placed so
  // its north wall face meets the target main room's south wall face at the
  // same world coordinate.
  hallwayOrigin: RoomWorldPos
  // The hallway-side wall geometry to drop on reveal (hallway's north wall,
  // fixed because all hub connections dock on the south edge).
  initialWallIdToDrop: string
  // The target-side wall geometry to drop on reveal (the dock segment named
  // in the scenario's hubConnection).
  targetWallIdToDrop: string
  // The two scoped room ids whose adjacency should be enabled on reveal:
  // the initial hallway room and the target's main room. Symmetric.
  crossInstanceEdge: { a: string; b: string }
}

// Hub connections are restricted to the target main room's south wall. The
// dock segment's x/z position + width are read directly from the geometry
// spec, so the hallway's placement is fully derivable from the one named id.
const EPS = 1e-4
const HALLWAY_DOCK_WALL_ID = 'initial_wn'

type HubConnection = NonNullable<ScenarioSpec['hubConnection']>

// Assert the scenario's hubConnection is internally consistent: the named
// room exists, the named geometry exists inside it, the segment sits on the
// south wall, its width matches the hallway's floorWidth, and it lies fully
// within the wall span. Thrown errors surface at content-load time so bad
// scenarios can't poison the hub flow later.
export function validateHubConnection(
  targetMap: GameMap,
  hub: HubConnection,
  initialMap: GameMap,
): void {
  const mainRoom = targetMap.rooms.find(r => r.id === hub.mainRoomId)
  if (!mainRoom) {
    throw new Error(
      `validateHubConnection: target map '${targetMap.mapInstanceId}' has no room '${hub.mainRoomId}'`,
    )
  }
  const dock = mainRoom.geometry?.find(g => g.id === hub.dockGeometryId)
  if (!dock) {
    throw new Error(
      `validateHubConnection: room '${hub.mainRoomId}' has no geometry '${hub.dockGeometryId}'`,
    )
  }
  const hallwayRoom = initialMap.rooms[0]
  if (!hallwayRoom) {
    throw new Error('validateHubConnection: initial map has no rooms')
  }
  assertOnSouthEdge(mainRoom, dock)
  assertWidthMatchesHallway(dock, hallwayRoom)
  assertWithinWallSpan(mainRoom, dock)
}

function assertOnSouthEdge(mainRoom: RoomSpec, dock: GeometrySpec): void {
  const southFaceLocalZ = mainRoom.floorDepth / 2
  const segmentSouthEdge = dock.cz + dock.depth / 2
  if (Math.abs(segmentSouthEdge - southFaceLocalZ) > EPS) {
    throw new Error(
      `validateHubConnection: dock '${dock.id}' south face at z=${segmentSouthEdge.toFixed(4)} ` +
      `does not sit on room '${mainRoom.id}' south edge at z=${southFaceLocalZ.toFixed(4)}`,
    )
  }
}

function assertWidthMatchesHallway(dock: GeometrySpec, hallway: RoomSpec): void {
  if (Math.abs(dock.width - hallway.floorWidth) > EPS) {
    throw new Error(
      `validateHubConnection: dock '${dock.id}' width ${dock.width} does not match ` +
      `hallway floorWidth ${hallway.floorWidth}`,
    )
  }
}

function assertWithinWallSpan(mainRoom: RoomSpec, dock: GeometrySpec): void {
  const dockLeft = dock.cx - dock.width / 2
  const dockRight = dock.cx + dock.width / 2
  const wallLeft = -mainRoom.floorWidth / 2
  const wallRight = mainRoom.floorWidth / 2
  if (dockLeft < wallLeft - EPS || dockRight > wallRight + EPS) {
    throw new Error(
      `validateHubConnection: dock '${dock.id}' span ` +
      `[${dockLeft.toFixed(4)}, ${dockRight.toFixed(4)}] exceeds ` +
      `room '${mainRoom.id}' south wall span [${wallLeft.toFixed(4)}, ${wallRight.toFixed(4)}]`,
    )
  }
}

// Compute where to place the initial hallway (in the target map's world
// frame) so its north-wall face meets the target room's south-wall face,
// and the scoped adjacency edge that connects them. The dock segment's
// x-position determines how the hallway slides along the wall — no separate
// `positionOnWall` field is needed. Assumes `validateHubConnection` has
// already been called on this hub connection.
export function computeHubAttachment(
  initialMap: GameMap,
  targetMap: GameMap,
  hub: HubConnection,
): HubAttachment {
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
  const dock = mainRoom.geometry?.find(g => g.id === hub.dockGeometryId)
  if (!dock) {
    throw new Error(
      `computeHubAttachment: room '${hub.mainRoomId}' has no geometry '${hub.dockGeometryId}'`,
    )
  }

  // Target main room's south wall face (world z = local cz + floorDepth/2).
  const targetOrigin = targetMap.origin ?? { x: 0, z: 0 }
  const targetSouthFaceWorldZ = targetOrigin.z + mainRoomPos.z + mainRoom.floorDepth / 2

  // Initial hallway's north wall face in hallway-local coords:
  //   local cz = -floorDepth/2
  const hallwayNorthFaceLocalZ = -hallwayRoom.floorDepth / 2

  // Solve for hallwayOrigin.z such that the two faces meet.
  const hallwayOriginZ = targetSouthFaceWorldZ - hallwayNorthFaceLocalZ

  // Align hallway x with the dock segment's x in the target's world frame —
  // the segment's authored cx is the single source of truth for "where along
  // the wall the hallway enters."
  const targetMainRoomWorldX = targetOrigin.x + mainRoomPos.x
  const hallwayOriginX = targetMainRoomWorldX + dock.cx

  return {
    hallwayOrigin: { x: hallwayOriginX, z: hallwayOriginZ },
    initialWallIdToDrop: HALLWAY_DOCK_WALL_ID,
    targetWallIdToDrop: dock.id,
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
