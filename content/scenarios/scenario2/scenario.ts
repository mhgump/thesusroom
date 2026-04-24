import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type {
  GameScript,
  GameScriptContext,
  PlayerEnterRoomPayload,
} from '../../../react-three-capacitor/server/src/GameScript.js'
import { MOVER_BOT } from '../../bots/scenario2/mover/bot.js'

// Designed around 4-player rooms (see content/scenario_plans/scenario2.json).
// MIN_PLAYERS is both `maxPlayers` and the bot-fill target.
const MIN_PLAYERS = 4
const BOT_FILL_DELAY_MS  = 3_000   // 60 ticks
// Delay between the first player/bot appearing in room1 and the north door
// opening. Gives bots that spawn directly into room1 a moment to settle and
// humans arriving via the hub transfer a beat to orient before the door
// drops and the move-warning timer starts.
const DOOR_OPEN_DELAY_MS = 2_000   // 40 ticks
const MOVE_WARN_DELAY_MS = 2_000   // 40 ticks
// Extended from 4s to 8s so fill bots (which start ticking later than any
// initially-provided bots) have enough bot-tick cycles between receiving
// `rule_move` and `eliminateStragglers` firing to actually walk into room2.
// With the shorter 4s delay the first-only-bot close-and-fill test saw
// fill bots eliminated mid-walk while the cli bot survived.
const ELIM_DELAY_MS      = 8_000   // 160 ticks
const FACT_DELAY_MS      = 1_000   // 20 ticks
// Holds the scenario open after `announceFact` so bots triggered by
// `ctx.exitBots()` have time to visibly walk off the east edge before the
// exit-transfer tears the room down.
const BOT_EXIT_DELAY_MS  = 5_000   // 100 ticks

interface S2State {
  fillScheduled: boolean
  doorScheduled: boolean
  doorOpened: boolean
  inRoom2: Record<string, true>
  allInRoom2Triggered: boolean
  roomListenerRegistered: boolean
}

const script: GameScript<S2State> = {
  initialState: () => ({
    fillScheduled: false,
    doorScheduled: false,
    doorOpened: false,
    inRoom2: {},
    allInRoom2Triggered: false,
    roomListenerRegistered: false,
  }),

  onPlayerConnect(state, ctx) {
    // Schedule the bot-fill on the very first connect so the scenario fills
    // up even if no additional humans arrive. Closing the scenario is
    // deferred until `openDoor` fires so bots spawned by the fill don't race
    // with an early close (ctx.spawnBot creates fresh WS clients that the
    // dispatcher rejects once the room is closed).
    if (!state.fillScheduled) {
      state.fillScheduled = true
      ctx.after(BOT_FILL_DELAY_MS, 'fillBots')
    }

    // Register the room-entry listener exactly once. It handles both the
    // first-entry-into-room1 trigger (which schedules the door to open) and
    // room2 tracking after the door opens.
    if (state.roomListenerRegistered) return
    state.roomListenerRegistered = true
    ctx.onPlayerEnterRoom('onEnterRoom')
  },

  handlers: {
    fillBots(state, ctx) {
      if (state.doorOpened) return
      const needed = MIN_PLAYERS - ctx.getPlayerIds().length
      for (let i = 0; i < needed; i++) ctx.spawnBot(MOVER_BOT)
    },

    onEnterRoom(state, ctx, payload: PlayerEnterRoomPayload) {
      const { roomId, playerId } = payload
      // First player or bot to land in the main room kicks off the door
      // timer. Bots spawned via `fillBots` trip this the same as humans
      // arriving via the hub transfer.
      if (roomId === 'scenario2_room1' && !state.doorScheduled && !state.doorOpened) {
        state.doorScheduled = true
        ctx.after(DOOR_OPEN_DELAY_MS, 'openDoor')
      }
      // Room2 tracking applies only after the scenario door has opened —
      // before that, entering room2 is impossible (north_door plug is solid).
      if (roomId === 'scenario2_room2' && state.doorOpened) {
        state.inRoom2[playerId] = true
        // Wait 250ms for the player to clear the doorway, then re-close the
        // door for them. resolveOverlap uses their current room's AABB to
        // pick the push direction, so no explicit room-lock is needed.
        ctx.after(250, 'reCloseDoorFor', playerId)
        checkAllInRoom2(state, ctx)
      }
    },

    openDoor(state, ctx) {
      if (state.doorOpened) return
      state.doorOpened = true
      ctx.closeScenario()
      for (const pid of ctx.getPlayerIds()) {
        ctx.addRule(pid, 'Players that do not continue will be eliminated.')
      }
      ctx.setGeometryVisible(['north_door'], false)
      ctx.after(MOVE_WARN_DELAY_MS, 'warnMove')
    },

    reCloseDoorFor(_state, ctx, playerId: string) {
      ctx.setGeometryVisible(['north_door'], true, [playerId])
    },

    warnMove(state, ctx) {
      const living = ctx.getPlayerIds()
      const inRoom1 = living.filter(p => !state.inRoom2[p])
      for (const pid of inRoom1) ctx.sendInstruction(pid, 'rule_move')
      ctx.after(ELIM_DELAY_MS, 'eliminateStragglers')
    },

    eliminateStragglers(state, ctx) {
      for (const pid of ctx.getPlayerIds()) {
        if (!state.inRoom2[pid]) ctx.eliminatePlayer(pid)
      }
      if (ctx.getPlayerIds().length === 0) {
        ctx.exitBots()
        ctx.after(BOT_EXIT_DELAY_MS, 'finalExit')
        return
      }
      checkAllInRoom2(state, ctx)
    },

    announceFact(state, ctx) {
      const survivors = ctx.getPlayerIds().length
      if (survivors === 0) return
      const specId = `fact_${survivors}`
      for (const pid of ctx.getPlayerIds()) ctx.sendInstruction(pid, specId)
      // Reveal room 3: remove the room2 north wall and show room3 to all survivors.
      ctx.setGeometryVisible(['room2_north_wall'], false)
      ctx.setRoomVisible(['scenario2_room3'], true)
      ctx.exitBots()
      ctx.after(BOT_EXIT_DELAY_MS, 'finalExit')
    },

    finalExit(_state, ctx) {
      ctx.exitScenario()
    },
  },
}

function checkAllInRoom2(state: S2State, ctx: GameScriptContext): void {
  if (state.allInRoom2Triggered) return
  const living = ctx.getPlayerIds()
  if (living.length === 0) return
  if (!living.every(p => state.inRoom2[p])) return
  state.allInRoom2Triggered = true
  ctx.after(FACT_DELAY_MS, 'announceFact')
}

export const SCENARIO: ScenarioSpec = {
  id: 'scenario2',
  timeoutMs: 90_000,
  maxPlayers: 4,
  script,
  initialVisibility: {
    'room2_north_wall': true,
  },
  initialRoomVisibility: {
    'scenario2_room3': false,
  },
  requiredRoomIds: ['scenario2_room1', 'scenario2_room2', 'scenario2_room3'],
  hubConnection: {
    mainRoomId: 'room1',
    dockGeometryId: 'r1_s',
  },
  exitConnection: {
    roomId: 'room3',
    dockGeometryId: 'r3_ne',
  },
}
