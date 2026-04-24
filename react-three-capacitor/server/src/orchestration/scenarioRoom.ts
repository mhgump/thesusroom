import type { GameMap } from '../../../src/game/GameMap.js'
import type { ScenarioSpec } from '../ContentRegistry.js'
import type { BotSpec } from '../bot/BotTypes.js'
import { MultiplayerRoom } from '../Room.js'
import type { RoomCreationContext } from './RoomOrchestration.js'

// Assembles a MultiplayerRoom wired to a single (map, scenario) pair. Every
// orchestration that fronts exactly one scenario per room goes through this
// helper — DefaultScenarioOrchestration for prod traffic and the scenario-run
// harness for the test runner. Keeping the wiring in one place means the two
// code paths cannot drift in how they attach maps, build scenarios, or opt
// into delayed-start.
export interface BuildScenarioRoomOptions {
  ctx: RoomCreationContext
  map: GameMap
  scenario: ScenarioSpec
  spawnBotFn: (routingKey: string, spec: BotSpec) => void
  // When false, the scenario is added as default-open but not started — ready
  // signals and connects buffer inside the Scenario until `startScenario` is
  // called. Defaults to true. The run-scenario flow sets this to false when
  // a browser observer is recording so the observer connects before any
  // script state advances.
  autoStart?: boolean
  tickRateHz?: number
  onScenarioTerminate?: (scenarioId: string) => void
}

export function createScenarioRoom(opts: BuildScenarioRoomOptions): MultiplayerRoom {
  const { ctx, map, scenario, spawnBotFn, autoStart = true, tickRateHz, onScenarioTerminate } = opts

  const room = new MultiplayerRoom({
    roomId: scenario.id,
    instanceIndex: ctx.instanceIndex,
    tickRateHz,
    onCloseScenario: ctx.onClose,
    onRoomDone: ctx.onDestroy,
    spawnBotFn: (spec) => spawnBotFn(ctx.routingKey, spec),
    spawnPosition: scenario.spawn,
    onScenarioTerminate,
    recordingManager: ctx.recordingManager,
    hubConnection: scenario.hubConnection,
    maxPlayers: scenario.maxPlayers,
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
