import type { GameMap } from '../../../src/game/GameMap.js'
import type { RoomWorldPos } from '../../../src/game/WorldSpec.js'
import { computeRoomPositions, scopedRoomId } from '../../../src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../src/game/CameraConstraint.js'
import type { GeometrySpec, RoomSpec } from '../../../src/game/RoomSpec.js'
import type { ScenarioSpec } from '../ContentRegistry.js'

// Geometry id pinned by the initial hallway map. The hallway has authored
// north and south walls keyed by these ids; the hub flow opens north (the
// scenario-side dock), the exit flow opens south (the source-side dock).
// Kept as constants because the dock walls live on the canonical initial
// map — every hub-capable scenario docks against the SAME hallway.
const EPS = 1e-4
const HALLWAY_HUB_DOCK_WALL_ID = 'initial_wn'
const HALLWAY_EXIT_DOCK_WALL_ID = 'initial_ws'

type HubConnection = NonNullable<ScenarioSpec['hubConnection']>
type ExitConnection = NonNullable<ScenarioSpec['exitConnection']>

// ── Shared dock-geometry assertions ──────────────────────────────────────────
// Used by the ContentRegistry validators (load-time content checks) AND the
// merge-arg computation paths to guard against malformed scenarios. Throws
// surface at content-load so a bad scenario can't poison the merge later.

export function assertHubDockOnSouthEdge(mainRoom: RoomSpec, dock: GeometrySpec): void {
  const southFaceLocalZ = mainRoom.floorDepthY / 2
  const segmentSouthEdge = dock.cz + dock.depth / 2
  if (Math.abs(segmentSouthEdge - southFaceLocalZ) > EPS) {
    throw new Error(
      `validateHubConnection: dock '${dock.id}' south face at z=${segmentSouthEdge.toFixed(4)} ` +
      `does not sit on room '${mainRoom.id}' south edge at z=${southFaceLocalZ.toFixed(4)}`,
    )
  }
}

export function assertExitDockOnNorthEdge(exitRoom: RoomSpec, dock: GeometrySpec): void {
  const northFaceLocalZ = -exitRoom.floorDepthY / 2
  const segmentNorthEdge = dock.cz - dock.depth / 2
  if (Math.abs(segmentNorthEdge - northFaceLocalZ) > EPS) {
    throw new Error(
      `validateExitConnection: dock '${dock.id}' north face at z=${segmentNorthEdge.toFixed(4)} ` +
      `does not sit on room '${exitRoom.id}' north edge at z=${northFaceLocalZ.toFixed(4)}`,
    )
  }
}

export function assertDockWidthMatchesHallway(dock: GeometrySpec, hallway: RoomSpec): void {
  if (Math.abs(dock.width - hallway.floorWidthX) > EPS) {
    throw new Error(
      `validateConnection: dock '${dock.id}' width ${dock.width} does not match ` +
      `hallway floorWidthX ${hallway.floorWidthX}`,
    )
  }
}

export function assertDockWithinWallSpan(room: RoomSpec, dock: GeometrySpec): void {
  const dockLeft = dock.cx - dock.width / 2
  const dockRight = dock.cx + dock.width / 2
  const wallLeft = -room.floorWidthX / 2
  const wallRight = room.floorWidthX / 2
  if (dockLeft < wallLeft - EPS || dockRight > wallRight + EPS) {
    throw new Error(
      `validateConnection: dock '${dock.id}' span ` +
      `[${dockLeft.toFixed(4)}, ${dockRight.toFixed(4)}] exceeds ` +
      `room '${room.id}' wall span [${wallLeft.toFixed(4)}, ${wallRight.toFixed(4)}]`,
    )
  }
}

// ── Content-load validators (called by ContentRegistry) ──────────────────────

// Assert the scenario's hubConnection is internally consistent: named room +
// geometry exist, segment sits on the south wall, width matches the hallway's
// floorWidthX, and lies fully within the wall span.
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
  assertHubDockOnSouthEdge(mainRoom, dock)
  assertDockWidthMatchesHallway(dock, hallwayRoom)
  assertDockWithinWallSpan(mainRoom, dock)
}

// Mirror of validateHubConnection for the source-map-north-edge exit dock.
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
  assertExitDockOnNorthEdge(exitRoom, dock)
  assertDockWidthMatchesHallway(dock, hallwayRoom)
  assertDockWithinWallSpan(exitRoom, dock)
}

// ── Merge-arg computation ────────────────────────────────────────────────────

// Args for an `acceptHubTransfer` call's `mergeMaps` step. Computed once per
// transfer from the scenario's hubConnection + the initial-hallway map.
//
// `targetWallPosition` is the door's normalized centre position along the
// target room's south wall (0..1, where 0 = west end, 1 = east end). The
// joining (hallway) side always centres on its own north wall (position 0.5)
// because the hallway is a single-room map and the dock spans its full
// authored width.
export interface HubMergeArgs {
  hallwayOrigin: RoomWorldPos
  joiningRoomId: string         // initial map's hallway room id
  joiningWallId: string         // hallway's north wall geom id (HALLWAY_HUB_DOCK_WALL_ID)
  targetWallPosition: number    // dock centre along target south wall, 0..1
  dockLength: number
}

export function computeHubMergeArgs(
  initialMap: GameMap,
  targetMap: GameMap,
  hub: HubConnection,
): HubMergeArgs {
  const hallwayRoom = initialMap.rooms[0]
  if (!hallwayRoom) throw new Error('computeHubMergeArgs: initial map has no rooms')

  const targetPositions = computeRoomPositions(targetMap)
  const mainRoom = targetMap.rooms.find(r => r.id === hub.mainRoomId)
  const mainRoomPos = targetPositions.get(hub.mainRoomId)
  if (!mainRoom || !mainRoomPos) {
    throw new Error(
      `computeHubMergeArgs: target map '${targetMap.mapInstanceId}' has no room '${hub.mainRoomId}'`,
    )
  }
  const dock = mainRoom.geometry?.find(g => g.id === hub.dockGeometryId)
  if (!dock) {
    throw new Error(
      `computeHubMergeArgs: room '${hub.mainRoomId}' has no geometry '${hub.dockGeometryId}'`,
    )
  }

  // Re-validate at compute time — cheap, and means a malformed runtime mutation
  // (theoretical) is caught here too rather than producing a misaligned dock.
  assertHubDockOnSouthEdge(mainRoom, dock)
  assertDockWidthMatchesHallway(dock, hallwayRoom)
  assertDockWithinWallSpan(mainRoom, dock)

  // Target main room's south wall face (world z = local cz + floorDepthY/2).
  const targetOrigin = targetMap.origin ?? { x: 0, z: 0 }
  const targetSouthFaceWorldZ = targetOrigin.z + mainRoomPos.z + mainRoom.floorDepthY / 2

  // Initial hallway's north wall face in hallway-local coords:
  //   local cz = -floorDepthY/2
  const hallwayNorthFaceLocalZ = -hallwayRoom.floorDepthY / 2
  const hallwayOriginZ = targetSouthFaceWorldZ - hallwayNorthFaceLocalZ

  // Align hallway x with the dock segment's x in the target's world frame —
  // the segment's authored cx is the single source of truth for "where along
  // the wall the hallway enters."
  const targetMainRoomWorldX = targetOrigin.x + mainRoomPos.x
  const hallwayOriginX = targetMainRoomWorldX + dock.cx

  // Dock centre as fraction along the south wall span.
  const targetWallPosition = (dock.cx + mainRoom.floorWidthX / 2) / mainRoom.floorWidthX

  return {
    hallwayOrigin: { x: hallwayOriginX, z: hallwayOriginZ },
    joiningRoomId: hallwayRoom.id,
    joiningWallId: HALLWAY_HUB_DOCK_WALL_ID,
    targetWallPosition,
    dockLength: dock.width,
  }
}

// Args for an `acceptExitTransfer` call's `mergeMaps` step. Source map's
// north-edge dock meets the hallway's south wall.
export interface ExitMergeArgs {
  // Origin to place the hallway in target world frame so its south face
  // meets the source's north face. Computed by the orchestrator before
  // building the target MR (the hallway is attached at construction time);
  // re-exposed here so the orchestrator can plumb spawn positions.
  hallwayOrigin: RoomWorldPos
  // Source map (joining-side) details.
  sourceRoomId: string
  sourceWallId: string         // dock geometry id on the source's north wall
  sourceWallPosition: number   // dock centre along source north wall, 0..1
  // Target (hallway) details.
  targetRoomScopedId: string   // scoped id of the hallway's single room
  targetWallId: string         // hallway's south wall geom id (HALLWAY_EXIT_DOCK_WALL_ID)
  dockLength: number
}

export function computeExitMergeArgs(
  sourceMap: GameMap,
  initialMap: GameMap,
  exit: ExitConnection,
): ExitMergeArgs {
  const hallwayRoom = initialMap.rooms[0]
  if (!hallwayRoom) throw new Error('computeExitMergeArgs: initial map has no rooms')

  const sourcePositions = computeRoomPositions(sourceMap)
  const exitRoom = sourceMap.rooms.find(r => r.id === exit.roomId)
  const exitRoomPos = sourcePositions.get(exit.roomId)
  if (!exitRoom || !exitRoomPos) {
    throw new Error(
      `computeExitMergeArgs: source map '${sourceMap.mapInstanceId}' has no room '${exit.roomId}'`,
    )
  }
  const dock = exitRoom.geometry?.find(g => g.id === exit.dockGeometryId)
  if (!dock) {
    throw new Error(
      `computeExitMergeArgs: room '${exit.roomId}' has no geometry '${exit.dockGeometryId}'`,
    )
  }

  assertExitDockOnNorthEdge(exitRoom, dock)
  assertDockWidthMatchesHallway(dock, hallwayRoom)
  assertDockWithinWallSpan(exitRoom, dock)

  // `computeRoomPositions` already bakes `sourceMap.origin` into the
  // returned positions, so `exitRoomPos` is in the target MR's world frame
  // verbatim — don't add the origin again.
  const sourceNorthFaceWorldZ = exitRoomPos.z - exitRoom.floorDepthY / 2
  const hallwayOriginZ = sourceNorthFaceWorldZ - hallwayRoom.floorDepthY / 2
  const hallwayOriginX = exitRoomPos.x + dock.cx

  const sourceWallPosition = (dock.cx + exitRoom.floorWidthX / 2) / exitRoom.floorWidthX

  return {
    hallwayOrigin: { x: hallwayOriginX, z: hallwayOriginZ },
    sourceRoomId: exit.roomId,
    sourceWallId: dock.id,
    sourceWallPosition,
    targetRoomScopedId: scopedRoomId(initialMap.mapInstanceId, hallwayRoom.id),
    targetWallId: HALLWAY_EXIT_DOCK_WALL_ID,
    dockLength: dock.width,
  }
}

// ── Map shifting / renaming helpers ──────────────────────────────────────────

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
