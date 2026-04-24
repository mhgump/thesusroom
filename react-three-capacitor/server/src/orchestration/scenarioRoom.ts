import type { GameMap } from '../../../src/game/GameMap.js'
import type { ScenarioSpec } from '../ContentRegistry.js'
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
  // When false, the scenario is added as default-open but not started — ready
  // signals and connects buffer inside the Scenario until `startScenario` is
  // called. Defaults to true. The run-scenario flow sets this to false when
  // a browser observer is recording so the observer connects before any
  // script state advances.
  autoStart?: boolean
  tickRateHz?: number
  onScenarioTerminate?: (scenarioId: string) => void
  // Fires when a scenario running in the created room invokes
  // `ctx.exitScenario()`. Receives the source room along with its map/spec
  // so the caller can build a target exit-hallway MR and transfer players.
  // Only meaningful for scenarios whose spec carries `exitConnection`.
  onExitScenario?: (sourceRoom: MultiplayerRoom, sourceMap: GameMap, sourceScenario: ScenarioSpec) => void
  // When false, the created room does not advertise itself as a hub-fill
  // target even if the scenario spec carries `hubConnection`. Used by the
  // scenario-run harness so stray `/` connections can't be routed into the
  // one-shot room that the test runner just registered. Defaults to true.
  allowHubFill?: boolean
}

export function createScenarioRoom(opts: BuildScenarioRoomOptions): MultiplayerRoom {
  const { ctx, map, scenario, autoStart = true, tickRateHz, onScenarioTerminate, onExitScenario, allowHubFill = true } = opts

  // Holder captured by the MR's onExitScenario callback below. Assigned on
  // the line after `new MultiplayerRoom(...)` so the callback (which only
  // fires after the tick loop starts) always sees a non-null reference.
  let self: MultiplayerRoom | null = null

  const room = new MultiplayerRoom({
    roomId: scenario.id,
    instanceIndex: ctx.instanceIndex,
    tickRateHz,
    onCloseScenario: ctx.onClose,
    onRoomDone: ctx.onDestroy,
    spawnPosition: scenario.spawn,
    onScenarioTerminate,
    onExitScenario: (scenario.exitConnection && onExitScenario)
      ? () => {
          if (!self) return
          onExitScenario(self, map, scenario)
        }
      : undefined,
    recordingManager: ctx.recordingManager,
    hubConnection: allowHubFill ? scenario.hubConnection : undefined,
    maxPlayers: scenario.maxPlayers,
  })
  self = room

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
