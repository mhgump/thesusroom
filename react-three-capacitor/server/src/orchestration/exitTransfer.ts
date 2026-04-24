import type WebSocket from 'ws'
import type { GameMap } from '../../../src/game/GameMap.js'
import type { ScenarioSpec } from '../ContentRegistry.js'
import type { PlayerRecordingManager } from '../PlayerRecordingManager.js'
import type { BotSpec } from '../bot/BotTypes.js'
import type { GameScript } from '../GameScript.js'
import type { ScenarioConfig } from '../Scenario.js'
import { MultiplayerRoom } from '../Room.js'
import { scopedRoomId } from '../../../src/game/WorldSpec.js'
import {
  computeExitAttachment,
  renameMapInstance,
  shiftMapToOrigin,
  type ExitAttachment,
} from './hubAttachment.js'
import { MAP as INITIAL_MAP } from '../../../../assets/initial/map.js'
import { buildExitScript } from '../../../../assets/initial/exitScript.js'

// Monotonic counter for exit-hallway target MR ids AND for the renamed
// source-map instance id. Each transfer gets a fresh prefix so a chained
// sequence (the /loop flow) can attach N hallway instances in a single
// target World without the global geometry-state map collapsing them onto
// one another.
let exitHallwayCounter = 0

export interface BuildTargetScenarioArgs {
  attachment: ExitAttachment
  // Renamed source map instance id — the id actually attached to the target
  // world. Scripts that want to drop the source map later must use this id,
  // not the original one.
  sourceMapInstanceId: string
  // Scoped room ids contributed by the (renamed, shifted) source map.
  // Handed to target scripts so they can hide the previous hallway from
  // new joiners via per-player room visibility.
  sourceScopedRoomIds: string[]
  hallwayScopedRoomId: string
}

export interface ExecuteExitTransferArgs {
  sourceRoom: MultiplayerRoom
  sourceMap: GameMap
  sourceScenario: ScenarioSpec
  rebindWs: (ws: WebSocket, room: MultiplayerRoom, playerId: string) => void
  recordingManager?: PlayerRecordingManager
  spawnBotFn: (routingKey: string, spec: BotSpec) => void
  // Optional override for the scenario that runs on the freshly-built target
  // MR. Defaults to `buildExitScript` (the one-shot exit-hallway behavior).
  // The /loop flow supplies its own factory that re-arms another transfer
  // after the source map is removed.
  buildTargetScenario?: (args: BuildTargetScenarioArgs) => {
    scenarioId: string
    script: GameScript<any>
    config: Omit<ScenarioConfig, 'id' | 'script'>
  }
  // Optional wiring for the target MR's own `ctx.exitScenario()` hook. When
  // set, the target MR can itself fire another exit transfer. Used by the
  // /loop flow so each fresh hallway automatically advances to the next.
  targetOnExitScenario?: (targetRoom: MultiplayerRoom) => void
  // Caps the target MR's `maxPlayers`. Defaults to `sourceRoom.maxPlayers`.
  targetMaxPlayers?: number
}

export interface ExitTransferResult {
  // Freshly-built target MR. Caller is responsible for holding / releasing
  // this reference; it is not registered in `MultiplayerRoomRegistry`.
  targetRoom: MultiplayerRoom
  // The shifted hallway map actually attached to the target. Origin reflects
  // the cumulative shift from the target MR's world frame (z stepping by
  // -1.5 per /loop iteration). Caller should feed this back as the
  // `sourceMap` argument on the NEXT `executeExitTransfer` call for the
  // same chain — otherwise attachment math would treat the source as
  // centred on origin and the player would land outside the new source.
  targetHallwayMap: GameMap
  // Attachment used for this transfer. Exposed for telemetry / callers
  // building their own next-step state.
  attachment: ExitAttachment
}

// Hand off every seated player from `sourceRoom` into a fresh initial-hallway
// MR. Called in response to a scenario invoking `ctx.exitScenario()` — i.e.
// server-initiated, not driven by an incoming WebSocket. Returns the new
// target MR + the shifted hallway map so chained callers can thread the
// shifted map back in as the next `sourceMap`.
export function executeExitTransfer(args: ExecuteExitTransferArgs): ExitTransferResult {
  const {
    sourceRoom,
    sourceMap,
    sourceScenario,
    rebindWs,
    recordingManager,
    spawnBotFn,
    buildTargetScenario = buildExitScript,
    targetOnExitScenario,
    targetMaxPlayers,
  } = args

  const exit = sourceScenario.exitConnection
  if (!exit) {
    throw new Error(
      `[exitTransfer] scenario '${sourceScenario.id}' has no exitConnection; ctx.exitScenario() should not fire`,
    )
  }

  exitHallwayCounter++
  const transferPrefix = `t${exitHallwayCounter}`
  const targetRoutingKey = `exit/${sourceScenario.id}/${exitHallwayCounter}`
  const targetRoomId = `exit-hallway-${exitHallwayCounter}`

  // Rename the source map to a unique instance id + prefix its geometry ids
  // so it can coexist with any identically-authored target map in one World.
  // Necessary for the /loop flow (source = target = initial hallway); benign
  // for cross-scenario flows (e.g. scenario1 → initial).
  const renamedSourceInstanceId = `${transferPrefix}_${sourceMap.mapInstanceId}`
  const { map: renamedSource, renameGeomId } = renameMapInstance(sourceMap, renamedSourceInstanceId)
  const renamedExit = {
    roomId: exit.roomId,
    dockGeometryId: renameGeomId(exit.dockGeometryId),
  }

  const attachment = computeExitAttachment(renamedSource, INITIAL_MAP, renamedExit)

  const hallwayScopedRoomId = scopedRoomId(INITIAL_MAP.mapInstanceId, INITIAL_MAP.rooms[0].id)
  const sourceScopedRoomIds = renamedSource.rooms.map(r => scopedRoomId(renamedSource.mapInstanceId, r.id))
  const targetBuild = buildTargetScenario({
    attachment,
    sourceMapInstanceId: renamedSource.mapInstanceId,
    sourceScopedRoomIds,
    hallwayScopedRoomId,
  })

  // New connections arriving mid-cycle spawn inside the new hallway. The
  // hallway is placed at `attachment.hallwayOrigin`; add the hallway's local
  // spawn offset so we land near the entrance (not exactly on the boundary
  // wall, which overlap-resolve would push off).
  const hallwayLocalSpawn = { x: 0, z: 0.5 }
  const targetSpawn = {
    x: attachment.hallwayOrigin.x + hallwayLocalSpawn.x,
    z: attachment.hallwayOrigin.z + hallwayLocalSpawn.z,
  }

  const target = new MultiplayerRoom({
    roomId: targetRoomId,
    instanceIndex: exitHallwayCounter,
    maxPlayers: targetMaxPlayers ?? sourceRoom.maxPlayers,
    spawnPosition: targetSpawn,
    recordingManager,
    exitAttachment: attachment,
    onExitScenario: targetOnExitScenario ? () => targetOnExitScenario(target) : undefined,
    // Scenario-spawn callbacks are scoped to the new routing key so any bots
    // the target script spawns (currently none) reconnect into this
    // transfer's orchestration. Informational unless a ConnectionHandler is
    // registered under that key.
    spawnBotFn: (spec) => spawnBotFn(targetRoutingKey, spec),
  })

  // Attach the shifted hallway north of the source, then the renamed source
  // at its original origin. Players' world-space positions in the source MR
  // are preserved 1:1 in this frame (source was at origin in the source MR,
  // still at origin here), so no coordinate translation is needed on seat.
  const shiftedHallway = shiftMapToOrigin(INITIAL_MAP, attachment.hallwayOrigin)
  const hallwayRoomIds = target.addMap(shiftedHallway)
  const sourceRoomIds = target.addMap(renamedSource)

  const scenario = target.buildScenario(
    [...hallwayRoomIds, ...sourceRoomIds],
    {
      id: targetBuild.scenarioId,
      script: targetBuild.script,
      ...targetBuild.config,
    },
  )
  target.scenarios.add(scenario, { default: true })
  target.startScenario(targetBuild.scenarioId)

  // Snapshot source players now; releasing them inside the loop would mutate
  // the source map while we're iterating it.
  const handles = sourceRoom.getPlayerHandles()
  console.log(
    `[exitTransfer] ${sourceRoom.roomId} → ${targetRoomId} ` +
    `(scenario=${sourceScenario.id}, players=${handles.length}, ` +
    `hallway@(${attachment.hallwayOrigin.x.toFixed(3)},${attachment.hallwayOrigin.z.toFixed(3)}))`,
  )

  for (const handle of handles) {
    if (handle.ws.readyState !== handle.ws.OPEN) continue
    sourceRoom.releasePlayer(handle.playerId)
    // World-space position carries over 1:1 — the source map is at the same
    // origin in the target world, so the player stays physically in place.
    const newPlayerId = target.acceptExitTransfer(
      handle.ws,
      handle.browserUuid,
      targetRoutingKey,
      { x: handle.x, z: handle.z },
    )
    rebindWs(handle.ws, target, newPlayerId)
  }

  // All players are off the source MR; tear it down so the registry slot
  // frees up. Any bots still mid-handshake will get a 4004 on their next
  // retry — acceptable for v1.
  sourceRoom.closeAndDestroy()

  return { targetRoom: target, targetHallwayMap: shiftedHallway, attachment }
}
