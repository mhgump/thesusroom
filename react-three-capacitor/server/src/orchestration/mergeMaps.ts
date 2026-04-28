import type { GameMap } from '../../../src/game/GameMap.js'
import type { RoomSpec, Wall } from '../../../src/game/RoomSpec.js'
import type { MultiplayerRoom } from '../Room.js'
import { scopedRoomId } from '../../../src/game/WorldSpec.js'

// Generic primitive: merge a `joiningMap` into the `target` MR's world by
// docking one of its rooms against an existing room in the target. Replaces
// the special-cased hub/exit "MR merge" code that used to live on Room.ts.
//
// Behavior:
//   1. Calls `target.attachMap(...)` — which goes through RoomManager.attachMap
//      and creates the cross-instance ConnectionRecord (so Task 5's
//      connection-gap movement check works at the new edge).
//   2. For every player ALREADY seated in `target` (i.e. existing players),
//      hides every room of the joining map per-player. Combined with the
//      wire-filter on map_add (sends to a player only if that player has at
//      least one room of the map visible), this means existing players never
//      see the joining map on the wire and can't enter it.
//
// What it does NOT do:
//   - Does not seat any players.
//   - Does not toggle the dock walls. The caller (orchestrator) is responsible
//     for `scene.toggleEntityVisibilityOff(...)` + `physics.toggleEntityCollisionsOff(...)`
//     on each joining player after seating, and for restoring those toggles
//     when the player crosses the dock (typically wired through an
//     `onPlayerEnterRoom` script handler).
//   - Does not broadcast `map_add`. Welcome/world_reset for the joining
//     player carries the joining map, and the wire-filter on `broadcastMapAdd`
//     (called by the orchestrator if other players need to learn about the
//     map mid-session) handles the per-player gate.
export interface MergeMapsArgs {
  // The MR receiving the joining map.
  target: MultiplayerRoom
  // The map being joined in. The caller is responsible for any `shiftMapToOrigin`
  // / `renameMapInstance` transforms BEFORE calling mergeMaps — the math here
  // assumes `joiningMap` is the final-form map ready to attach.
  joiningMap: GameMap
  // Local room id within `joiningMap` that docks against the target. Must
  // exist in `joiningMap.rooms`.
  joiningRoomId: string
  // Wall on `joiningRoom` that meets the dock (in joining-map-local frame).
  joiningWall: Wall
  // 0..1 along that wall where the door sits (centre of the door span).
  joiningWallPosition: number
  // Existing scoped room id in `target.world` to dock against. The cross-
  // instance edge connects this room to the joining-side room.
  targetRoomScopedId: string
  // Wall on the target room that meets the dock (in target-map-local frame).
  targetWall: Wall
  // 0..1 along that wall where the door sits.
  targetWallPosition: number
  // Width of the door opening.
  dockLength: number
}

export interface MergeResult {
  // The actual `mapInstanceId` of the attached joining map. Same as
  // `joiningMap.mapInstanceId` — exposed for caller convenience so it can
  // hand the id to per-joiner toggles or a later `removeMap`.
  attachedMapInstanceId: string
  // Scoped room id of the joining-side dock room (i.e. the room a joining
  // player first appears in). Useful for setting per-joiner accessible-room
  // overrides if the caller needs them.
  joiningRoomScopedId: string
  // Scoped room id of the target-side dock room (matches `targetRoomScopedId`
  // — re-exported for symmetry with the joining-side return).
  targetRoomScopedId: string
}

export function mergeMaps(args: MergeMapsArgs): MergeResult {
  const {
    target,
    joiningMap,
    joiningRoomId,
    joiningWall,
    joiningWallPosition,
    targetRoomScopedId,
    targetWall,
    targetWallPosition,
    dockLength,
  } = args

  const joiningRoom: RoomSpec | undefined = joiningMap.rooms.find(r => r.id === joiningRoomId)
  if (!joiningRoom) {
    throw new Error(`mergeMaps: joining map '${joiningMap.mapInstanceId}' has no room '${joiningRoomId}'`)
  }
  if (!target.world.getRoomByScopedId(targetRoomScopedId)) {
    throw new Error(`mergeMaps: target world has no room '${targetRoomScopedId}'`)
  }

  // 1) Cross-instance attach. RoomManager.attachMap places the joining map
  //    at the computed origin so the two dock walls meet, and registers a
  //    bidirectional ConnectionRecord between target room and joining room.
  target.world.attachMap({
    map: joiningMap,
    targetRoomScopedId,
    connectionAtTarget: {
      wall: targetWall,
      length: dockLength,
      position: targetWallPosition,
      transitionRegion: 'toEdge',
    },
    mapRoomId: joiningRoomId,
    connectionAtMapRoom: {
      wall: joiningWall,
      length: dockLength,
      position: joiningWallPosition,
      transitionRegion: 'toEdge',
    },
  })

  // 2) Hide every room of the joining map from every EXISTING player in the
  //    target MR. New (joining) players are seated AFTER mergeMaps returns,
  //    so they aren't iterated here — the joining map is visible to them by
  //    default, which is the desired behavior.
  const scene = target.world.getScene()
  const joiningScopedIds = joiningMap.rooms.map(r => scopedRoomId(joiningMap.mapInstanceId, r.id))
  for (const existingPlayerId of target.getLivingPlayerIds()) {
    for (const scopedId of joiningScopedIds) {
      // toggleRoomOff returns ok:false if the player is currently in the
      // target room — for an existing player in the target MR who's never
      // seen the joining map, that branch never triggers, but the
      // defensive check is cheap.
      scene.toggleRoomOff(scopedId, existingPlayerId)
    }
  }

  return {
    attachedMapInstanceId: joiningMap.mapInstanceId,
    joiningRoomScopedId: scopedRoomId(joiningMap.mapInstanceId, joiningRoomId),
    targetRoomScopedId,
  }
}
