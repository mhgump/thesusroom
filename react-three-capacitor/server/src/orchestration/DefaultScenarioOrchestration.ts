import type { GameMap } from '../../../src/game/GameMap.js'
import type { ScenarioSpec } from '../ContentRegistry.js'
import type { BotSpec } from '../bot/BotTypes.js'
import { MultiplayerRoom } from '../Room.js'
import type { OrchestrationContext, RoomOrchestration } from './RoomOrchestration.js'

// Ships the original "one world, one map, one scenario" policy: at most one
// open room per routing key, close via `ctx.closeScenario`, destroy on last
// disconnect. Scenario-spawned bots reconnect into the same routing key.
//
// When `autoStartScenario` is false the scenario is added as the default-open
// scenario but not started — connected players and their ready signals buffer
// inside the scenario until `room.startScenario(id)` is called. Used by the
// run-scenario harness so the scenario only begins once the observer browser
// is recording.
export interface DefaultScenarioOrchestrationOptions {
  tickRateHz?: number
  autoStartScenario?: boolean
  // Forwarded to every room built by this orchestration. Fired when a
  // scenario invokes `ctx.terminate()`.
  onScenarioTerminate?: (scenarioId: string) => void
}

export class DefaultScenarioOrchestration implements RoomOrchestration {
  constructor(
    private readonly map: GameMap,
    private readonly scenario: ScenarioSpec,
    private readonly spawnBotFn: (routingKey: string, spec: BotSpec) => void,
    private readonly options?: DefaultScenarioOrchestrationOptions,
  ) {}

  createRoom(ctx: OrchestrationContext): MultiplayerRoom {
    const { map, scenario } = this
    const autoStart = this.options?.autoStartScenario ?? true

    const room = new MultiplayerRoom({
      roomId: scenario.id,
      instanceIndex: ctx.instanceIndex,
      tickRateHz: this.options?.tickRateHz,
      onCloseScenario: ctx.onClose,
      onRoomDone: ctx.onDestroy,
      spawnBotFn: (spec) => this.spawnBotFn(ctx.routingKey, spec),
      spawnPosition: scenario.spawn,
      onScenarioTerminate: this.options?.onScenarioTerminate,
    })

    const attachedRoomIds = room.addMap(map)
    const scenarioInstance = room.buildScenario(attachedRoomIds, {
      id: scenario.id,
      script: scenario.script,
      instructionSpecs: map.instructionSpecs,
      voteRegions: map.voteRegions,
      buttons: map.buttons,
      initialVisibility: scenario.initialVisibility ?? {},
      initialRoomVisibility: scenario.initialRoomVisibility ?? {},
      requiredRoomIds: scenario.requiredRoomIds,
    })
    room.scenarios.add(scenarioInstance, { default: true })
    if (autoStart) room.startScenario(scenario.id)

    return room
  }

  isOpen(room: MultiplayerRoom): boolean {
    return room.isOpen()
  }
}
