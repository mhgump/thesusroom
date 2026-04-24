import type {
  GameScript,
  GameScriptContext,
  GameScriptHandler,
  ActiveVoteRegionChangeEvent,
  VoteChangedPayload,
  PlayerEnterRoomPayload,
  ButtonPressPayload,
} from './GameScript.js'
import type {
  GameSpec,
  VoteRegionSpec,
  InstructionEventSpec,
  ButtonSpec,
  ButtonConfig,
  ButtonState,
  RuleLabel,
} from './GameSpec.js'
import type { World } from './World.js'
import type { ServerMessage } from './types.js'
import type { BotSpec } from './bot/BotTypes.js'
import { ButtonManager } from './ButtonManager.js'

// The pluggable hooks a MultiplayerRoom provides to a Scenario. The scenario
// uses these to reach connected players, the world, and the tick scheduler
// without knowing the surrounding room implementation.
export interface ScenarioDeps {
  world: World
  sendToPlayer: (playerId: string, msg: ServerMessage) => void
  broadcast: (msg: ServerMessage) => void
  // Remove a player from the enclosing room (used for elimination / HP=0).
  removePlayer: (playerId: string, eliminated?: boolean) => void
  // Fired once when `ctx.closeScenario()` is invoked. Typically the room
  // removes this scenario from the default-open slot.
  onClose: () => void
  // Fired when `ctx.terminate()` is invoked. Optional — production servers
  // leave this unset; the run-scenario CLI wires it to resolve its done
  // promise. Not related to `onClose`: terminate signals "success reached",
  // close signals "no more joiners".
  onTerminate?: () => void
  spawnBot: (spec: BotSpec) => void
  scheduleSimMs: (ms: number, cb: () => void) => () => void
  // Resolves a world position to a scoped room id (from the attached map).
  getRoomAtPosition?: (x: number, z: number) => string | null
  getServerTick: () => number
  // Sim-ms per server tick. Used by Scenario to compute `fireAtTick` for
  // dump/restore of timers; matches the enclosing room's tick rate.
  getSimMsPerTick: () => number
}

// The per-instance configuration a Scenario is constructed with. Most of it
// comes from the ScenarioSpec + attached map's GameSpec; the list of attached
// inner-world rooms is passed in separately so scenarios can be scoped to a
// subset of a World's map instance.
export interface ScenarioConfig {
  id: string
  script: GameScript<any> | null
  gameSpec: GameSpec | null
  // Initial globally-visible state for each geometry id the scenario cares
  // about. Unknown keys are allowed — any id not listed here is treated as
  // "on" (solid) by default until the scenario toggles it.
  initialVisibility: Record<string, boolean>
  initialRoomVisibility: Record<string, boolean>
  requiredRoomIds?: string[]
}

// Per-registration data. These are the records the scenario dumps/restores —
// nothing in here is a closure or a direct reference to a script function, so
// the whole table round-trips through JSON.
interface TimerRecord {
  fireAtTick: number
  handlerId: string
  payload: unknown
}
interface VoteListenerRecord {
  regionIds: string[]
  handlerId: string
}
interface RoomEnterListenerRecord {
  handlerId: string
}
interface ButtonListenerRecord {
  buttonId: string
  handlerId: string
}

// Dumpable snapshot of everything the script controls: the script's own
// `state` object plus the pending-registrations table keyed by synthesized
// ids. Consumers may `JSON.stringify` this directly. The shape mirrors
// `Scenario.restoreState`'s input.
export interface ScenarioDump {
  state: unknown
  nextId: number
  pending: {
    timers: Record<string, TimerRecord>
    voteListeners: Record<string, VoteListenerRecord>
    roomEnterListeners: Record<string, RoomEnterListenerRecord>
    buttonPressListeners: Record<string, ButtonListenerRecord>
    buttonReleaseListeners: Record<string, ButtonListenerRecord>
  }
}

export class Scenario {
  readonly id: string
  private readonly script: GameScript<any> | null
  private scriptState: unknown = null
  private readonly voteRegionSpecs: Map<string, VoteRegionSpec>
  private readonly instructionSpecs: Map<string, InstructionEventSpec>
  private readonly activeRegions: Set<string> = new Set()
  private readonly globalGeomVisible: Map<string, boolean>
  private readonly globalRoomVisible: Map<string, boolean>
  private readonly attachedRoomIds: Set<string>

  // Insertion-ordered sets of attached and ready player ids. start() replays
  // lifecycle callbacks for each set in arrival order.
  private readonly attachedPlayerIds: Set<string> = new Set()
  private readonly readyPlayerIds: Set<string> = new Set()

  private readonly playerRegions: Map<string, string | null> = new Map()
  // Per-player override of geometry visibility. Keys are geometry ids the
  // scenario has explicitly set for that player.
  private readonly playerGeometry: Map<string, Map<string, boolean>> = new Map()
  private readonly playerCurrentRoom: Map<string, string | null> = new Map()
  private readonly playerRoomVisible: Map<string, Map<string, boolean>> = new Map()

  // Pending-registrations tables. All registrations go in by id; dispatchers
  // iterate the entries rather than traversing a closure list.
  private readonly timers: Map<string, TimerRecord & { cancel: () => void }> = new Map()
  private readonly voteListeners: Map<string, VoteListenerRecord> = new Map()
  private readonly roomEnterListeners: Map<string, RoomEnterListenerRecord> = new Map()
  private readonly buttonPressListeners: Map<string, ButtonListenerRecord> = new Map()
  private readonly buttonReleaseListeners: Map<string, ButtonListenerRecord> = new Map()
  // Monotonic counter used to mint registration ids. Dumped/restored so
  // post-restore registrations continue the same sequence.
  private nextId = 1

  private readonly buttonManager: ButtonManager | null

  private started = false
  private alive = true
  private readonly deps: ScenarioDeps
  private readonly ctx: GameScriptContext

  constructor(attachedRoomIds: string[], config: ScenarioConfig, deps: ScenarioDeps) {
    this.id = config.id
    this.deps = deps
    this.attachedRoomIds = new Set(attachedRoomIds)

    if (config.requiredRoomIds && config.requiredRoomIds.length > 0) {
      const missing = config.requiredRoomIds.filter(id => !this.attachedRoomIds.has(id))
      if (missing.length > 0) {
        throw new Error(
          `Scenario '${config.id}' requires room ids not present in attached room set: ${missing.join(', ')}`,
        )
      }
    }

    this.script = config.script
    this.scriptState = config.script ? config.script.initialState() : null
    const gameSpec = config.gameSpec
    this.voteRegionSpecs = new Map((gameSpec?.voteRegions ?? []).map(r => [r.id, r]))
    this.instructionSpecs = new Map((gameSpec?.instructionSpecs ?? []).map(s => [s.id, s]))
    this.globalGeomVisible = new Map(Object.entries(config.initialVisibility))
    this.globalRoomVisible = new Map(Object.entries(config.initialRoomVisibility))
    for (const [id, visible] of this.globalGeomVisible) {
      if (!visible) this.deps.world.toggleGeometryOff(id)
    }

    const buttons = gameSpec?.buttons ?? []
    this.buttonManager = buttons.length > 0
      ? new ButtonManager(buttons, (ms, cb) => this.scheduleScoped(ms, cb))
      : null

    this.ctx = this.makeContext()
  }

  isStarted(): boolean { return this.started }
  isAlive(): boolean { return this.alive }

  // One-way transition. Replays onPlayerConnect for every attached player in
  // attach order, then onPlayerReady for every ready player in ready order.
  // Subsequent attach / ready events flow through normally.
  start(): void {
    if (!this.alive || this.started) return
    this.started = true
    if (!this.script) return
    for (const pid of this.attachedPlayerIds) {
      this.script.onPlayerConnect?.(this.scriptState, this.ctx, pid)
    }
    if (this.script.onPlayerReady) {
      for (const pid of this.readyPlayerIds) {
        this.script.onPlayerReady(this.scriptState, this.ctx, pid)
      }
    }
  }

  // Terminal. Scheduled callbacks routed through scheduleScoped are dropped
  // at dispatch time; no further attach/ready/move events take effect.
  delete(): void {
    if (!this.alive) return
    this.alive = false
  }

  onPlayerAttach(playerId: string): void {
    if (!this.alive) return
    if (this.attachedPlayerIds.has(playerId)) return
    this.attachedPlayerIds.add(playerId)
    this.playerRegions.set(playerId, null)
    this.playerCurrentRoom.set(playerId, null)
    this.playerGeometry.set(playerId, new Map())

    if (this.globalGeomVisible.size > 0) {
      this.deps.sendToPlayer(playerId, {
        type: 'geometry_state',
        updates: [...this.globalGeomVisible].map(([id, visible]) => ({ id, visible })),
      })
    }

    const roomVisState = new Map(this.globalRoomVisible)
    this.playerRoomVisible.set(playerId, roomVisState)
    if (roomVisState.size > 0) {
      this.deps.sendToPlayer(playerId, {
        type: 'room_visibility_state',
        updates: [...roomVisState].map(([roomId, visible]) => ({ roomId, visible })),
      })
    }

    const buttonData = this.buttonManager?.getInitData() ?? []
    if (buttonData.length > 0) {
      this.deps.sendToPlayer(playerId, { type: 'button_init', buttons: buttonData })
    }

    if (this.script && this.started) {
      this.script.onPlayerConnect?.(this.scriptState, this.ctx, playerId)
    }
  }

  onPlayerReady(playerId: string): void {
    if (!this.alive) return
    if (!this.attachedPlayerIds.has(playerId)) return
    if (this.readyPlayerIds.has(playerId)) return
    this.readyPlayerIds.add(playerId)
    if (!this.script?.onPlayerReady) return
    if (!this.started) return
    this.script.onPlayerReady(this.scriptState, this.ctx, playerId)
  }

  onPlayerDetach(playerId: string): void {
    if (!this.attachedPlayerIds.has(playerId)) return
    this.attachedPlayerIds.delete(playerId)
    this.readyPlayerIds.delete(playerId)
    this.playerRegions.delete(playerId)
    this.playerCurrentRoom.delete(playerId)
    this.playerGeometry.delete(playerId)
    this.playerRoomVisible.delete(playerId)
    if (this.buttonManager) {
      const changes = this.buttonManager.removePlayer(playerId)
      for (const { buttonId } of changes) this.evaluateButton(buttonId)
    }
    this.emitVoteAssignments()
  }

  onPlayerMoved(playerId: string): void {
    if (!this.alive) return
    if (!this.attachedPlayerIds.has(playerId)) return

    const p = this.deps.world.getPlayer(playerId)
    if (!p) return

    const oldRegion = this.playerRegions.get(playerId) ?? null
    const newRegion = this.regionAt(p.x, p.z)
    if (newRegion !== oldRegion) {
      this.playerRegions.set(playerId, newRegion)
      this.notifyVoteListeners(oldRegion, newRegion)
    }

    if (this.buttonManager) {
      const changes = this.buttonManager.updatePlayerPosition(playerId, p.x, p.z)
      for (const { buttonId } of changes) this.evaluateButton(buttonId)
    }

    const getRoomAtPosition = this.deps.getRoomAtPosition
    if (getRoomAtPosition) {
      const oldRoom = this.playerCurrentRoom.get(playerId) ?? null
      const newRoom = getRoomAtPosition(p.x, p.z)
      if (newRoom !== null && newRoom !== oldRoom) {
        this.playerCurrentRoom.set(playerId, newRoom)
        this.deps.world.setPlayerRoom(playerId, newRoom)
        this.dispatchRoomEnter(playerId, newRoom)
      }
    }
  }

  // Snapshot of the script's per-scenario state plus every pending
  // registration. Safe to JSON.stringify — contains no function refs, no
  // class instances, no closures. Restoring requires the same script + spec.
  dumpState(): ScenarioDump {
    const timers: Record<string, TimerRecord> = {}
    for (const [id, t] of this.timers) {
      timers[id] = { fireAtTick: t.fireAtTick, handlerId: t.handlerId, payload: t.payload }
    }
    return {
      state: this.scriptState,
      nextId: this.nextId,
      pending: {
        timers,
        voteListeners: Object.fromEntries(this.voteListeners),
        roomEnterListeners: Object.fromEntries(this.roomEnterListeners),
        buttonPressListeners: Object.fromEntries(this.buttonPressListeners),
        buttonReleaseListeners: Object.fromEntries(this.buttonReleaseListeners),
      },
    }
  }

  // Rehydrate from a dump produced by `dumpState()` against the same script.
  // Timers are re-armed using `fireAtTick - getServerTick()` so replays keep
  // the same sim-tick firing point. Must be called before `start()`.
  restoreState(dump: ScenarioDump): void {
    if (this.started) throw new Error('restoreState must be called before start()')
    this.scriptState = dump.state
    this.nextId = dump.nextId
    for (const [id, rec] of Object.entries(dump.pending.voteListeners)) {
      this.voteListeners.set(id, rec)
    }
    for (const [id, rec] of Object.entries(dump.pending.roomEnterListeners)) {
      this.roomEnterListeners.set(id, rec)
    }
    for (const [id, rec] of Object.entries(dump.pending.buttonPressListeners)) {
      this.buttonPressListeners.set(id, rec)
    }
    for (const [id, rec] of Object.entries(dump.pending.buttonReleaseListeners)) {
      this.buttonReleaseListeners.set(id, rec)
    }
    const now = this.deps.getServerTick()
    const simMsPerTick = this.deps.getSimMsPerTick()
    for (const [id, rec] of Object.entries(dump.pending.timers)) {
      const ticksRemaining = Math.max(0, rec.fireAtTick - now)
      const ms = ticksRemaining * simMsPerTick
      const cancel = this.scheduleScoped(ms, () => this.fireTimer(id))
      this.timers.set(id, { ...rec, cancel })
    }
  }

  // Returns the current game state for the given observed player without
  // mutating any scenario state. Called by the room when an observer joins.
  getPlayerSnapshotData(observedPlayerId: string): {
    geometryUpdates: Array<{ id: string; visible: boolean }> | null
    roomVisibilityUpdates: Array<{ roomId: string; visible: boolean }> | null
    buttonData: Array<ButtonSpec & { state: ButtonState; occupancy: number }>
    voteAssignments: Record<string, string[]> | null
  } {
    let geometryUpdates: Array<{ id: string; visible: boolean }> | null = null
    const playerState = this.playerGeometry.get(observedPlayerId)
    if (this.globalGeomVisible.size > 0 || (playerState && playerState.size > 0)) {
      const merged = new Map(this.globalGeomVisible)
      if (playerState) for (const [id, v] of playerState) merged.set(id, v)
      geometryUpdates = [...merged].map(([id, visible]) => ({ id, visible }))
    }

    let roomVisibilityUpdates: Array<{ roomId: string; visible: boolean }> | null = null
    const roomState = this.playerRoomVisible.get(observedPlayerId)
    if (roomState && roomState.size > 0) {
      roomVisibilityUpdates = [...roomState].map(([roomId, visible]) => ({ roomId, visible }))
    } else if (this.globalRoomVisible.size > 0) {
      roomVisibilityUpdates = [...this.globalRoomVisible].map(([roomId, visible]) => ({ roomId, visible }))
    }

    const buttonData = this.buttonManager?.getInitData() ?? []

    let voteAssignments: Record<string, string[]> | null = null
    if (this.activeRegions.size > 0) {
      const assignments: Record<string, string[]> = {}
      for (const regionId of this.activeRegions) assignments[regionId] = []
      for (const [pid, rid] of this.playerRegions) {
        if (rid && rid in assignments) assignments[rid].push(pid)
      }
      voteAssignments = assignments
    }

    return { geometryUpdates, roomVisibilityUpdates, buttonData, voteAssignments }
  }

  // ── private helpers ───────────────────────────────────────────────────────

  private mintId(prefix: string): string {
    return `${prefix}${this.nextId++}`
  }

  // Wraps sim-ms scheduler with an alive-gate. Callbacks queued before
  // delete() but dispatched after are dropped.
  private scheduleScoped(ms: number, cb: () => void): () => void {
    return this.deps.scheduleSimMs(ms, () => { if (this.alive) cb() })
  }

  private invokeHandler(handlerId: string, payload: unknown): void {
    if (!this.script || !this.alive) return
    const handler = this.script.handlers?.[handlerId] as GameScriptHandler<unknown, unknown> | undefined
    if (!handler) {
      console.warn(`[Scenario:${this.id}] missing handler '${handlerId}'`)
      return
    }
    handler(this.scriptState, this.ctx, payload)
  }

  private fireTimer(timerId: string): void {
    const rec = this.timers.get(timerId)
    if (!rec) return
    this.timers.delete(timerId)
    this.invokeHandler(rec.handlerId, rec.payload)
  }

  private dispatchRoomEnter(playerId: string, roomId: string): void {
    const payload: PlayerEnterRoomPayload = { playerId, roomId }
    for (const { handlerId } of [...this.roomEnterListeners.values()]) {
      this.invokeHandler(handlerId, payload)
    }
  }

  private emitVoteAssignments(): void {
    const assignments: Record<string, string[]> = {}
    for (const regionId of this.activeRegions) assignments[regionId] = []
    for (const [pid, rid] of this.playerRegions) {
      if (rid && rid in assignments) assignments[rid].push(pid)
    }
    this.deps.broadcast({ type: 'vote_assignment_change', assignments })
  }

  private evaluateButton(buttonId: string): void {
    const bm = this.buttonManager!
    const state = bm.getState(buttonId)
    const occupants = bm.getOccupants(buttonId)
    const config = bm.getConfig(buttonId)
    if (state === undefined || !occupants || !config) return

    if (state === 'idle' && occupants.size >= config.requiredPlayers) {
      bm.setState(buttonId, 'pressed')
      this.deps.broadcast({ type: 'button_state', id: buttonId, state: 'pressed', occupancy: occupants.size })
      const payload: ButtonPressPayload = { occupants: [...occupants] }
      for (const rec of [...this.buttonPressListeners.values()]) {
        if (rec.buttonId === buttonId) this.invokeHandler(rec.handlerId, payload)
      }
      return
    }

    if (state === 'pressed' && !config.holdAfterRelease && occupants.size < config.requiredPlayers) {
      for (const rec of [...this.buttonReleaseListeners.values()]) {
        if (rec.buttonId === buttonId) this.invokeHandler(rec.handlerId, undefined)
      }
      if (config.cooldownMs > 0) {
        bm.startCooldown(buttonId, config.cooldownMs, () => {
          bm.setState(buttonId, 'idle')
          this.deps.broadcast({
            type: 'button_state',
            id: buttonId,
            state: 'idle',
            occupancy: bm.getOccupants(buttonId)!.size,
          })
        })
        this.deps.broadcast({ type: 'button_state', id: buttonId, state: 'cooldown', occupancy: occupants.size })
      } else {
        bm.setState(buttonId, 'idle')
        this.deps.broadcast({ type: 'button_state', id: buttonId, state: 'idle', occupancy: occupants.size })
      }
      return
    }

    this.deps.broadcast({ type: 'button_state', id: buttonId, state, occupancy: occupants.size })
  }

  private regionAt(x: number, z: number): string | null {
    for (const [id, r] of this.voteRegionSpecs) {
      if (!this.activeRegions.has(id)) continue
      if (Math.hypot(x - r.x, z - r.z) <= r.radius) return id
    }
    return null
  }

  private notifyVoteListeners(oldRegion: string | null, newRegion: string | null): void {
    const changed = new Set<string>()
    if (oldRegion) changed.add(oldRegion)
    if (newRegion) changed.add(newRegion)
    const assignments: Record<string, string | null> = {}
    for (const [pid, rid] of this.playerRegions) assignments[pid] = rid
    const payload: VoteChangedPayload = { assignments }
    for (const rec of [...this.voteListeners.values()]) {
      if (rec.regionIds.some(r => changed.has(r))) {
        this.invokeHandler(rec.handlerId, payload)
      }
    }
    this.emitVoteAssignments()
  }

  private makeContext(): GameScriptContext {
    const self = this
    const world = this.deps.world
    return {
      sendInstruction(playerId, specId) {
        const spec = self.instructionSpecs.get(specId)
        if (spec) self.deps.sendToPlayer(playerId, {
          type: 'instruction',
          lines: [{ text: spec.text, label: spec.label, specId }],
        })
      },
      sendInstructions(playerId, specIds) {
        const lines = specIds
          .map(id => self.instructionSpecs.get(id))
          .filter((s): s is InstructionEventSpec => s !== undefined)
          .map(s => ({ text: s.text, label: s.label, specId: s.id }))
        if (lines.length > 0) self.deps.sendToPlayer(playerId, { type: 'instruction', lines })
      },
      toggleVoteRegion(regionId, active) {
        if (active) self.activeRegions.add(regionId)
        else self.activeRegions.delete(regionId)
        self.emitVoteAssignments()
      },
      onVoteChanged(regionIds, handlerId) {
        const id = self.mintId('vote_')
        self.voteListeners.set(id, { regionIds: [...regionIds], handlerId })
        return id
      },
      after(durationMs, handlerId, payload) {
        const id = self.mintId('t_')
        const cancel = self.scheduleScoped(durationMs, () => self.fireTimer(id))
        const simMsPerTick = self.deps.getSimMsPerTick()
        const fireAtTick = self.deps.getServerTick() + Math.max(1, Math.ceil(durationMs / simMsPerTick))
        self.timers.set(id, { fireAtTick, handlerId, payload: payload ?? null, cancel })
        return id
      },
      cancelAfter(timerId) {
        const rec = self.timers.get(timerId)
        if (!rec) return
        rec.cancel()
        self.timers.delete(timerId)
      },
      off(listenerId) {
        if (self.voteListeners.delete(listenerId)) return
        if (self.roomEnterListeners.delete(listenerId)) return
        if (self.buttonPressListeners.delete(listenerId)) return
        self.buttonReleaseListeners.delete(listenerId)
      },
      getPlayerIds() {
        return [...self.playerRegions.keys()]
      },
      getPlayerPosition(playerId) {
        const p = world.getPlayer(playerId)
        return p ? { x: p.x, z: p.z } : null
      },
      eliminatePlayer(playerId) {
        self.deps.removePlayer(playerId, true)
      },
      closeScenario() {
        self.deps.onClose()
      },
      terminate() {
        self.deps.onTerminate?.()
      },
      setGeometryVisible(geometryIds, visible, playerIds) {
        const perPlayer = !!(playerIds && playerIds.length > 0)
        if (perPlayer) {
          const updates = geometryIds.map(id => ({ id, visible }))
          for (const pid of playerIds!) {
            let m = self.playerGeometry.get(pid)
            if (!m) { m = new Map(); self.playerGeometry.set(pid, m) }
            for (const id of geometryIds) m.set(id, visible)
            self.deps.sendToPlayer(pid, { type: 'geometry_state', updates, perPlayer: true })
            for (const id of geometryIds) {
              if (visible) world.toggleGeometryOn(id, pid)
              else world.toggleGeometryOff(id, pid)
            }
          }
        } else {
          const updates = geometryIds.map(id => ({ id, visible }))
          for (const pid of self.playerGeometry.keys()) {
            self.deps.sendToPlayer(pid, { type: 'geometry_state', updates })
          }
          for (const id of geometryIds) {
            self.globalGeomVisible.set(id, visible)
            if (visible) world.toggleGeometryOn(id)
            else world.toggleGeometryOff(id)
          }
        }
      },
      getVoteAssignments() {
        return new Map(self.playerRegions)
      },
      onButtonPress(buttonId, handlerId) {
        if (!self.buttonManager) return self.mintId('btnp_')
        const id = self.mintId('btnp_')
        self.buttonPressListeners.set(id, { buttonId, handlerId })
        return id
      },
      onButtonRelease(buttonId, handlerId) {
        if (!self.buttonManager) return self.mintId('btnr_')
        const id = self.mintId('btnr_')
        self.buttonReleaseListeners.set(id, { buttonId, handlerId })
        return id
      },
      modifyButton(buttonId, changes) {
        if (!self.buttonManager) return
        self.buttonManager.patchConfig(buttonId, changes)
        self.deps.broadcast({ type: 'button_config', id: buttonId, changes })
        self.evaluateButton(buttonId)
      },
      setButtonState(buttonId, state) {
        if (!self.buttonManager) return
        self.buttonManager.setState(buttonId, state)
        const occupants = self.buttonManager.getOccupants(buttonId)
        self.deps.broadcast({
          type: 'button_state',
          id: buttonId,
          state,
          occupancy: occupants?.size ?? 0,
        })
      },
      sendNotification(text, playerIds) {
        const targets = playerIds ?? [...self.playerRegions.keys()]
        for (const pid of targets) self.deps.sendToPlayer(pid, { type: 'notification', text })
      },
      applyDamage(playerId, amount) {
        const event = world.applyDamage(playerId, amount)
        if (!event) return
        const p = world.getPlayer(playerId)
        if (p) {
          self.deps.broadcast({
            type: 'player_update',
            playerId,
            x: p.x,
            z: p.z,
            events: [event],
            serverTick: self.deps.getServerTick(),
          })
        }
        if (event.newHp === 0) self.deps.removePlayer(playerId, true)
      },
      onPlayerEnterRoom(handlerId) {
        const id = self.mintId('enter_')
        self.roomEnterListeners.set(id, { handlerId })
        return id
      },
      spawnBot(spec) {
        for (const key of Object.keys(spec.onInstructMap)) {
          if (!self.instructionSpecs.has(key)) {
            throw new Error(
              `[BotSpec] onInstructMap key "${key}" is not a valid instruction spec id for this scenario`,
            )
          }
        }
        self.deps.spawnBot(spec)
      },
      setConnectionEnabled(scopedRoomIdA, scopedRoomIdB, enabled) {
        world.setConnectionEnabled(scopedRoomIdA, scopedRoomIdB, enabled)
      },
      setPlayerAllowedRooms(playerId, scopedRoomIds) {
        world.setAccessibleRoomsOverride(playerId, scopedRoomIds)
      },
      setRoomVisible(roomIds, visible, playerIds) {
        const perPlayer = !!(playerIds && playerIds.length > 0)
        const targets = perPlayer ? playerIds! : [...self.playerRoomVisible.keys()]
        const updates = roomIds.map(roomId => ({ roomId, visible }))
        for (const pid of targets) {
          const state = self.playerRoomVisible.get(pid)
          if (!state) continue
          for (const roomId of roomIds) state.set(roomId, visible)
          self.deps.sendToPlayer(pid, { type: 'room_visibility_state', updates, perPlayer })
        }
        if (!perPlayer) {
          for (const roomId of roomIds) self.globalRoomVisible.set(roomId, visible)
        }
      },
      addRule(playerId, text) {
        world.addPlayerRule(playerId, text)
        self.deps.sendToPlayer(playerId, { type: 'add_rule', text })
      },
    }
  }
}

// Re-exported so downstream consumers can reach the event type without
// importing from GameScript.ts directly.
export type { ActiveVoteRegionChangeEvent }
