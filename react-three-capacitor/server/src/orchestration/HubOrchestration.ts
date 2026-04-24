import type { GameMap } from '../../../src/game/GameMap.js'
import type { RoomWorldPos } from '../../../src/game/WorldSpec.js'
import { computeRoomPositions } from '../../../src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../src/game/CameraConstraint.js'
import { MultiplayerRoom } from '../Room.js'
import { MAP as INITIAL_MAP } from '../../../../assets/initial/map.js'
import type { ScenarioSpec } from '../ContentRegistry.js'
import type { BotSpec } from '../bot/BotTypes.js'
import type { OrchestrationContext, RoomOrchestration } from './RoomOrchestration.js'

// First-pass hub orchestration.
//
// Rather than maintaining a separate transit room (MR1) and transferring
// players into a target room (MR2) via rebase/map_extend messages, this
// first pass builds a single MultiplayerRoom that contains BOTH the initial
// hallway and the target scenario's map, positioned so the player can walk
// directly from one into the other. The hub opens the two connection walls
// at room construction time and wires the world adjacency; the target
// scenario's script runs as the default, attaching connecting players on
// join. No separate hub script is needed.
//
// Placement: initial stays at its authored origin (0, 0) so the client's
// statically-loaded `CURRENT_MAP` matches the server's initial geometry
// placement — no client-side rebase is needed. The target scenario is
// placed NORTH of initial (lower z) so the player can walk out of initial's
// north end into the target's south side.
//
// Scenario2's room1 has a south wall (r1_s) at local z=+0.3625. Placing
// scenario2 at origin z=-1.125 puts r1_s at world z=-0.7625, flush with
// initial's north wall (initial_wn) at world z=-0.7375. The two wall faces
// meet at the world boundary z=-0.75. Player walks north (decreasing z)
// out of initial, crosses z=-0.75, and enters room1.
const TARGET_HUB_ORIGIN: RoomWorldPos = { x: 0, z: -1.125 }

// The hub reuses initial's authored spawn (0, 0.5) unchanged — initial's
// origin is not shifted, so the spawn is already in the hallway's south
// third, facing north.
const HUB_SPAWN = { x: 0, z: 0.5 }

function shiftedMap(map: GameMap, origin: RoomWorldPos): GameMap {
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

export class HubOrchestration implements RoomOrchestration {
  constructor(
    private readonly targetScenario: ScenarioSpec,
    private readonly targetMap: GameMap,
    private readonly spawnBotFn: (routingKey: string, spec: BotSpec) => void,
  ) {}

  createRoom(ctx: OrchestrationContext): MultiplayerRoom {
    const target = this.targetScenario
    const targetMap = this.targetMap

    const room = new MultiplayerRoom({
      roomId: `hub:${target.id}`,
      instanceIndex: ctx.instanceIndex,
      onCloseScenario: ctx.onClose,
      onRoomDone: ctx.onDestroy,
      spawnBotFn: (spec) => this.spawnBotFn(ctx.routingKey, spec),
      spawnPosition: HUB_SPAWN,
      recordingManager: ctx.recordingManager,
    })

    const initialRoomIds = room.addMap(INITIAL_MAP)
    const shiftedTarget = shiftedMap(targetMap, TARGET_HUB_ORIGIN)
    const targetRoomIds = room.addMap(shiftedTarget)

    // Open the two connection walls directly. `initial_wn` is the initial
    // hallway's (authored-as-north) wall; `r1_s` is target room1's south
    // wall. Both are solid by default; the hub drops them so the player
    // can cross between the hallway and room1.
    room.world.toggleGeometryOff('initial_wn')
    room.world.toggleGeometryOff('r1_s')

    // Wire the stay-in-rooms adjacency so the world lets the player cross.
    const initialHallScopedId = initialRoomIds[0]
    const targetConnectRoomId = `${shiftedTarget.mapInstanceId}_room1`
    room.world.setConnectionEnabled(initialHallScopedId, targetConnectRoomId, true)

    // Build the target scenario as default-open. Attached rooms include
    // initial's hall so requiredRoomIds containment (if any) passes and so
    // `setGeometryVisible` with no explicit playerIds reaches players that
    // are still in the hallway.
    const targetScenario = room.buildScenario(
      [...initialRoomIds, ...targetRoomIds],
      {
        id: target.id,
        script: target.script,
        instructionSpecs: targetMap.instructionSpecs,
        voteRegions: targetMap.voteRegions,
        buttons: targetMap.buttons,
        initialVisibility: target.initialVisibility ?? {},
        initialRoomVisibility: target.initialRoomVisibility ?? {},
        requiredRoomIds: target.requiredRoomIds,
      },
    )
    room.scenarios.add(targetScenario, { default: true })
    room.startScenario(target.id)

    return room
  }

  isOpen(room: MultiplayerRoom): boolean {
    return room.isOpen()
  }
}
