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

// Exit-transfer analogue of HubAttachment. The source map stays at its
// original origin inside the target MR — the hallway is placed NORTH of the
// source so the hallway's south face meets the source's north face. Keeping
// the source in place means player world-space positions carry over across
// the transfer without a visible teleport.
export interface ExitAttachment {
  // World-space origin at which the initial hallway map should be placed.
  hallwayOrigin: RoomWorldPos
  // Hallway-side wall geometry to drop on reveal (hallway's south wall).
  initialWallIdToDrop: string
  // Source-side wall geometry to drop on reveal (the segment named in the
  // scenario's exitConnection).
  sourceWallIdToDrop: string
  // Scoped room ids whose adjacency should be enabled on reveal: the source
  // exit room and the initial hallway room. Symmetric.
  crossInstanceEdge: { a: string; b: string }
}

// Hub connections are restricted to the target main room's south wall. The
// dock segment's x/z position + width are read directly from the geometry
// spec, so the hallway's placement is fully derivable from the one named id.
const EPS = 1e-4
const HALLWAY_DOCK_WALL_ID = 'initial_wn'
// Exit connections dock the hallway's south wall to the source exit-room's
// north wall. Mirror of HALLWAY_DOCK_WALL_ID for the reverse direction.
const HALLWAY_EXIT_WALL_ID = 'initial_ws'

type HubConnection = NonNullable<ScenarioSpec['hubConnection']>
type ExitConnection = NonNullable<ScenarioSpec['exitConnection']>

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

function assertOnNorthEdge(mainRoom: RoomSpec, dock: GeometrySpec): void {
  const northFaceLocalZ = -mainRoom.floorDepth / 2
  const segmentNorthEdge = dock.cz - dock.depth / 2
  if (Math.abs(segmentNorthEdge - northFaceLocalZ) > EPS) {
    throw new Error(
      `validateExitConnection: dock '${dock.id}' north face at z=${segmentNorthEdge.toFixed(4)} ` +
      `does not sit on room '${mainRoom.id}' north edge at z=${northFaceLocalZ.toFixed(4)}`,
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
      `room '${mainRoom.id}' wall span [${wallLeft.toFixed(4)}, ${wallRight.toFixed(4)}]`,
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

// Validate a scenario's exitConnection: named room + geometry exist, segment
// sits on the north wall, width matches the hallway's floorWidth, and span
// lies inside the wall. Mirrors validateHubConnection.
export function validateExitConnection(
  sourceMap: GameMap,
  exit: ExitConnection,
  initialMap: GameMap,
): void {
  const exitRoom = sourceMap.rooms.find(r => r.id === exit.roomId)
  if (!exitRoom) {
    throw new Error(
      `validateExitConnection: source map '${sourceMap.mapInstanceId}' has no room '${exit.roomId}'`,
    )
  }
  const dock = exitRoom.geometry?.find(g => g.id === exit.dockGeometryId)
  if (!dock) {
    throw new Error(
      `validateExitConnection: room '${exit.roomId}' has no geometry '${exit.dockGeometryId}'`,
    )
  }
  const hallwayRoom = initialMap.rooms[0]
  if (!hallwayRoom) {
    throw new Error('validateExitConnection: initial map has no rooms')
  }
  assertOnNorthEdge(exitRoom, dock)
  assertWidthMatchesHallway(dock, hallwayRoom)
  assertWithinWallSpan(exitRoom, dock)
}

// Compute where to place the hallway in the target MR's world frame so the
// hallway's south face meets the source exit-room's north face. The source
// stays at its authored origin; only the hallway is shifted. This preserves
// player world-space positions across the transfer — the client's welcome
// carries the same `(x, z)` pair it held on the source MR, so the local
// camera and physics body don't visibly jump when the ws rebinds. Assumes
// `validateExitConnection` has already run.
export function computeExitAttachment(
  sourceMap: GameMap,
  initialMap: GameMap,
  exit: ExitConnection,
): ExitAttachment {
  const hallwayRoom = initialMap.rooms[0]
  if (!hallwayRoom) throw new Error('computeExitAttachment: initial map has no rooms')

  const sourcePositions = computeRoomPositions(sourceMap)
  const exitRoom = sourceMap.rooms.find(r => r.id === exit.roomId)
  const exitRoomPos = sourcePositions.get(exit.roomId)
  if (!exitRoom || !exitRoomPos) {
    throw new Error(
      `computeExitAttachment: source map '${sourceMap.mapInstanceId}' has no room '${exit.roomId}'`,
    )
  }
  const dock = exitRoom.geometry?.find(g => g.id === exit.dockGeometryId)
  if (!dock) {
    throw new Error(
      `computeExitAttachment: room '${exit.roomId}' has no geometry '${exit.dockGeometryId}'`,
    )
  }

  // `computeRoomPositions` already bakes `sourceMap.origin` into the
  // returned positions, so `exitRoomPos` is in the target MR's world frame
  // verbatim — don't add the origin again.
  const sourceNorthFaceWorldZ = exitRoomPos.z - exitRoom.floorDepth / 2
  // Hallway room centre in hallway-local z = 0 (single-room hallway). Its
  // south face local z = +floorDepth/2. World z of hallway south face =
  // hallwayOrigin.z + 0 + hallwayRoom.floorDepth/2. Solve for hallwayOrigin.z.
  const hallwayOriginZ = sourceNorthFaceWorldZ - hallwayRoom.floorDepth / 2
  // Align x: dock.cx on the source side (already in world frame via
  // exitRoomPos) meets hallwayOrigin.x + 0 on the hallway side.
  const hallwayOriginX = exitRoomPos.x + dock.cx

  return {
    hallwayOrigin: { x: hallwayOriginX, z: hallwayOriginZ },
    initialWallIdToDrop: HALLWAY_EXIT_WALL_ID,
    sourceWallIdToDrop: dock.id,
    crossInstanceEdge: {
      a: scopedRoomId(sourceMap.mapInstanceId, exit.roomId),
      b: scopedRoomId(initialMap.mapInstanceId, hallwayRoom.id),
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

// Clone a GameMap with a fresh map-instance id AND every geometry id prefixed
// so the clone can coexist with the original inside the same World. Necessary
// for the loop-hallway flow, where source and target both derive from the
// initial map and would otherwise collide on shared geometry ids
// (`initial_ws`, `initial_wn`, ...) that the World keys state by. The
// `renameGeomId` helper is returned alongside so callers can translate
// original ids (e.g. an authored `exitConnection.dockGeometryId`) into the
// clone's namespace. Pass-through for rooms.id / vote regions / instructions
// / npcs (those live at the scenario layer and don't have global state
// collisions).
export function renameMapInstance(
  map: GameMap,
  newMapInstanceId: string,
): { map: GameMap; renameGeomId: (id: string) => string } {
  const prefix = `${newMapInstanceId}__`
  const renameGeomId = (id: string): string => `${prefix}${id}`
  const rooms = map.rooms.map(room => ({
    ...room,
    geometry: room.geometry?.map(g => ({ ...g, id: renameGeomId(g.id) })),
  }))
  const topology = { rooms, connections: map.connections, origin: map.origin }
  const localPositions = computeRoomPositions(topology)
  const artifacts = buildMapInstanceArtifacts(topology, newMapInstanceId)
  const cameraShapes = buildCameraConstraintShapes(topology, localPositions)
  return {
    map: {
      ...map,
      id: newMapInstanceId,
      mapInstanceId: newMapInstanceId,
      rooms,
      roomPositions: artifacts.roomPositions,
      cameraShapes,
      getRoomAtPosition: artifacts.getRoomAtPosition,
      getAdjacentRoomIds: artifacts.getAdjacentRoomIds,
      isRoomOverlapping: artifacts.isRoomOverlapping,
    },
    renameGeomId,
  }
}
