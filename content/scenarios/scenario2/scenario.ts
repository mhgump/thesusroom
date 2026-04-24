import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type {
  GameScript,
  GameScriptContext,
  PlayerEnterRoomPayload,
} from '../../../react-three-capacitor/server/src/GameScript.js'
import { SCENARIO2_BOT } from '../../bots/scenario2/filler/bot.js'

// Sim-time delays (ms). ctx.after is tick-driven, so these scale with server
// tick rate — 50ms of sim time = 1 tick at the canonical 20Hz.
const BOT_FILL_DELAY_MS  = 2_000   // 40 ticks
const MOVE_WARN_DELAY_MS = 2_000   // 40 ticks
const ELIM_DELAY_MS      = 4_000   // 80 ticks
const FACT_DELAY_MS      = 1_000   // 20 ticks

interface S2State {
  botTimerSet: boolean
  doorOpened: boolean
  inRoom2: Record<string, true>
  allInRoom2Triggered: boolean
  readyPlayers: Record<string, true>
}

const script: GameScript<S2State> = {
  initialState: () => ({
    botTimerSet: false,
    doorOpened: false,
    inRoom2: {},
    allInRoom2Triggered: false,
    readyPlayers: {},
  }),

  onPlayerConnect(state, ctx) {
    if (state.botTimerSet) return
    state.botTimerSet = true
    ctx.after(BOT_FILL_DELAY_MS, 'fillBots')
  },

  onPlayerReady(state, ctx, playerId) {
    if (state.doorOpened) return
    state.readyPlayers[playerId] = true

    const playerIds = ctx.getPlayerIds()
    if (playerIds.length < 4) return
    if (!playerIds.every(pid => state.readyPlayers[pid])) return

    state.doorOpened = true
    ctx.closeScenario()
    for (const pid of ctx.getPlayerIds()) {
      ctx.addRule(pid, 'Players that do not continue will be eliminated.')
    }
    ctx.setGeometryVisible(['north_door'], false)

    ctx.onPlayerEnterRoom('onEnterRoom')
    ctx.after(MOVE_WARN_DELAY_MS, 'warnMove')
  },

  handlers: {
    fillBots(state, ctx) {
      if (state.doorOpened) return
      const needed = 4 - ctx.getPlayerIds().length
      for (let i = 0; i < needed; i++) ctx.spawnBot(SCENARIO2_BOT)
    },

    onEnterRoom(state, ctx, payload: PlayerEnterRoomPayload) {
      const { playerId, roomId } = payload
      if (roomId !== 'scenario2_room2') return
      state.inRoom2[playerId] = true
      // Wait 250ms for the player to clear the doorway, then re-close the
      // door for them. resolveOverlap uses their current room's AABB to pick
      // the push direction, so no explicit room-lock is needed.
      ctx.after(250, 'reCloseDoorFor', playerId)
      checkAllInRoom2(state, ctx)
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
      ctx.terminate()
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
  script,
  initialVisibility: {
    'room2_north_wall': true,
  },
  initialRoomVisibility: {
    'scenario2_room3': false,
  },
  requiredRoomIds: ['scenario2_room1', 'scenario2_room2', 'scenario2_room3'],
}
