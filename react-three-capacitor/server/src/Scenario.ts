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
  VoteRegionSpec,
  InstructionEventSpec,
  ButtonSpec,
  ButtonState,
} from './GameSpec.js'
import type { World, WorldEvent } from './World.js'
import type { ServerMessage } from './types.js'
import type { BotSpec } from './bot/BotTypes.js'

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
  // Invoked by `ctx.exitScenario()`. Optional — only set when the enclosing
  // scenario's spec carries an `exitConnection` AND the server is wired for
  // exit transfers. Receives the scenario id so the server can look up the
  // source map/spec pair.
  onExitScenario?: (scenarioId: string) => void
  // Invoked by `ctx.removeMap(id)`. Removes the named map instance from the
  // enclosing room and broadcasts `map_remove`.
  removeMap: (mapInstanceId: string) => void
  scheduleSimMs: (ms: number, cb: () => void) => () => void
  // Resolves a world position to a scoped room id (from the attached map).
  getRoomAtPosition?: (x: number, z: number) => string | null
  getServerTick: () => number
  // Sim-ms per server tick. Used by Scenario to compute `fireAtTick` for
  // dump/restore of timers; matches the enclosing room's tick rate.
  getSimMsPerTick: () => number
}

// The per-instance configuration a Scenario is constructed with. Map-sourced
// content (instruction strings, vote regions, buttons) flows in as flat
// arrays — there is no intermediate `gameSpec` object. Button and vote-region
// state is owned by World; the scenario only uses `voteRegions` for listener
// validation and `buttons` as a presence-check.
export interface ScenarioConfig {
  id: string
  script: GameScript<any> | null
  instructionSpecs: InstructionEventSpec[]
  voteRegions: VoteRegionSpec[]
  buttons?: ButtonSpec[]
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
  private readonly instructionSpecs: Map<string, InstructionEventSpec>
  private readonly hasButtons: boolean
  private readonly attachedRoomIds: Set<string>

  // Insertion-ordered sets of attached and ready player ids. start() replays
  // lifecycle callbacks for each set in arrival order.
  private readonly attachedPlayerIds: Set<string> = new Set()
  private readonly readyPlayerIds: Set<string> = new Set()

  // Per-player room tracking used to dispatch onPlayerEnterRoom events. The
  // World already owns setPlayerRoom; scenario mirrors it so it can diff
  // on every move tick.
  private readonly playerCurrentRoom: Map<string, string | null> = new Map()

  // Players that have crossed into one of this scenario's attached rooms at
  // least once. Used to fire `onPlayerEnterScenario` exactly once per player.
  private readonly playersEntered: Set<string> = new Set()

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
    this.instructionSpecs = new Map(config.instructionSpecs.map(s => [s.id, s]))
    this.hasButtons = (config.buttons?.length ?? 0) > 0

    // Seed World with scenario-level initial state. From here on the World
    // owns the live values; we don't keep a local mirror.
    for (const [id, visible] of Object.entries(config.initialVisibility)) {
      if (!visible) this.deps.world.toggleGeometryOff(id)
    }
    const initiallyHiddenRooms = Object.entries(config.initialRoomVisibility)
      .filter(([, v]) => !v).map(([id]) => id)
    const initiallyVisibleRooms = Object.entries(config.initialRoomVisibility)
      .filter(([, v]) => v).map(([id]) => id)
    if (initiallyHiddenRooms.length > 0) this.deps.world.setRoomVisible(initiallyHiddenRooms, false)
    if (initiallyVisibleRooms.length > 0) this.deps.world.setRoomVisible(initiallyVisibleRooms, true)
    // setRoomVisible enqueues global events, but no players are attached at
    // construction time — drop them so the first tick doesn't broadcast a
    // phantom change to an empty room.
    this.deps.world.clearPendingGlobalEvents()

    this.ctx = this.makeContext()
  }

  isStarted(): boolean { return this.started }
  isAlive(): boolean { return this.alive }

  // One-way transition. Replays onPlayerConnect for every attached player in
  // attach order, then onPlayerReady for every ready player in ready order,
  // then onPlayerEnterScenario for every already-entered player.
  // Subsequent attach / ready / enter events flow through normally.
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
    if (this.script.onPlayerEnterScenario) {
      for (const pid of this.playersEntered) {
        this.script.onPlayerEnterScenario(this.scriptState, this.ctx, pid)
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
    this.playerCurrentRoom.set(playerId, null)

    // Initial state snapshot sourced from World. We derive the geometry /
    // room-visibility payloads from World's current state (global + any
    // per-player override) so a late-joining player sees the same world as
    // everyone else.
    const geomSnapshot = this.deps.world.getGeometryStateSnapshot()
    const geomUpdates: Array<{ id: string; visible: boolean }> = []
    for (const [id, visible] of geomSnapshot) {
      if (!visible) geomUpdates.push({ id, visible })
    }
    if (geomUpdates.length > 0) {
      this.deps.sendToPlayer(playerId, { type: 'geometry_state', updates: geomUpdates })
    }

    const roomVis = this.deps.world.getGlobalRoomVisibility()
    if (roomVis.size > 0) {
      this.deps.sendToPlayer(playerId, {
        type: 'room_visibility_state',
        updates: [...roomVis].map(([roomId, visible]) => ({ roomId, visible })),
      })
    }

    if (this.hasButtons) {
      const buttonData = this.deps.world.getButtonInitData()
      if (buttonData.length > 0) {
        this.deps.sendToPlayer(playerId, { type: 'button_init', buttons: buttonData })
      }
    }

    if (this.script && this.started) {
      this.script.onPlayerConnect?.(this.scriptState, this.ctx, playerId)
    }

    // Direct-scenario joins spawn the player straight into one of the
    // scenario's attached rooms — there's no walk-in move, so the enter hook
    // would never fire from onPlayerMoved alone. Resolve the spawn position
    // here and mark the player as entered if they start inside the scenario.
    const getRoomAtPosition = this.deps.getRoomAtPosition
    if (getRoomAtPosition) {
      const p = this.deps.world.getPlayer(playerId)
      if (p) {
        const scopedId = getRoomAtPosition(p.x, p.z)
        if (scopedId && this.attachedRoomIds.has(scopedId)) {
          this.playerCurrentRoom.set(playerId, scopedId)
          this.deps.world.setPlayerRoom(playerId, scopedId)
          this.playersEntered.add(playerId)
          if (this.script && this.started && this.script.onPlayerEnterScenario) {
            this.script.onPlayerEnterScenario(this.scriptState, this.ctx, playerId)
          }
        }
      }
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
    this.playerCurrentRoom.delete(playerId)
    this.playersEntered.delete(playerId)
    // World's removePlayer (called by the Room after us) handles clearing
    // vote assignments and button occupancy, emitting the relevant events.
  }

  onPlayerMoved(playerId: string): void {
    if (!this.alive) return
    if (!this.attachedPlayerIds.has(playerId)) return

    const p = this.deps.world.getPlayer(playerId)
    if (!p) return

    const getRoomAtPosition = this.deps.getRoomAtPosition
    if (getRoomAtPosition) {
      const oldRoom = this.playerCurrentRoom.get(playerId) ?? null
      const newRoom = getRoomAtPosition(p.x, p.z)
      if (newRoom !== null && newRoom !== oldRoom) {
        this.playerCurrentRoom.set(playerId, newRoom)
        this.deps.world.setPlayerRoom(playerId, newRoom)
        this.dispatchRoomEnter(playerId, newRoom)
        if (!this.playersEntered.has(playerId) && this.attachedRoomIds.has(newRoom)) {
          this.playersEntered.add(playerId)
          if (this.script?.onPlayerEnterScenario) {
            this.script.onPlayerEnterScenario(this.scriptState, this.ctx, playerId)
          }
        }
      }
    }
  }

  // Called by the Room with each world-level event emitted by processTick.
  // Routes press/release/vote-change events to the scripts that registered
  // for them. Other event types (button_state_change / button_config_change /
  // room_visibility_change) are Room-level concerns and need no scenario
  // dispatch — the room broadcasts them.
  onWorldEvent(event: WorldEvent): void {
    if (!this.alive || !this.script) return
    switch (event.type) {
      case 'button_press': {
        const payload: ButtonPressPayload = { occupants: [...event.occupants] }
        for (const rec of [...this.buttonPressListeners.values()]) {
          if (rec.buttonId === event.buttonId) this.invokeHandler(rec.handlerId, payload)
        }
        return
      }
      case 'button_release': {
        for (const rec of [...this.buttonReleaseListeners.values()]) {
          if (rec.buttonId === event.buttonId) this.invokeHandler(rec.handlerId, undefined)
        }
        return
      }
      case 'vote_region_change': {
        const changed = new Set(event.changedRegionIds)
        const payload: VoteChangedPayload = { assignments: { ...event.assignments } }
        for (const rec of [...this.voteListeners.values()]) {
          if (rec.regionIds.some(r => changed.has(r))) {
            this.invokeHandler(rec.handlerId, payload)
          }
        }
        return
      }
      default:
        return
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
    const world = this.deps.world
    const geomSnapshot = world.getGeometryStateSnapshot()
    const playerGeomOverride = world.getPlayerGeometrySnapshot(observedPlayerId)
    const merged = new Map(geomSnapshot)
    for (const [id, v] of playerGeomOverride) merged.set(id, v)
    const geometryUpdates: Array<{ id: string; visible: boolean }> | null =
      merged.size > 0 ? [...merged].map(([id, visible]) => ({ id, visible })) : null

    const globalRoomVis = world.getGlobalRoomVisibility()
    const playerRoomVis = world.getPlayerRoomVisibility(observedPlayerId)
    let roomVisibilityUpdates: Array<{ roomId: string; visible: boolean }> | null = null
    if (playerRoomVis.size > 0) {
      roomVisibilityUpdates = [...playerRoomVis].map(([roomId, visible]) => ({ roomId, visible }))
    } else if (globalRoomVis.size > 0) {
      roomVisibilityUpdates = [...globalRoomVis].map(([roomId, visible]) => ({ roomId, visible }))
    }

    const buttonData = this.hasButtons ? world.getButtonInitData() : []

    let voteAssignments: Record<string, string[]> | null = null
    const assignmentsByPlayer = world.getVoteAssignments()
    const activeRegions = world.getActiveVoteRegions()
    if (activeRegions.length > 0) {
      const assignments: Record<string, string[]> = {}
      for (const rid of activeRegions) assignments[rid] = []
      for (const [pid, rid] of assignmentsByPlayer) {
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
        world.setVoteRegionActive(regionId, active)
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
        return [...self.attachedPlayerIds]
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
        const updates = geometryIds.map(id => ({ id, visible }))
        if (perPlayer) {
          for (const pid of playerIds!) {
            self.deps.sendToPlayer(pid, { type: 'geometry_state', updates, perPlayer: true })
            for (const id of geometryIds) {
              if (visible) world.toggleGeometryOn(id, pid)
              else world.toggleGeometryOff(id, pid)
            }
          }
        } else {
          for (const pid of self.attachedPlayerIds) {
            self.deps.sendToPlayer(pid, { type: 'geometry_state', updates })
          }
          for (const id of geometryIds) {
            if (visible) world.toggleGeometryOn(id)
            else world.toggleGeometryOff(id)
          }
        }
      },
      getVoteAssignments() {
        return world.getVoteAssignments()
      },
      onButtonPress(buttonId, handlerId) {
        const id = self.mintId('btnp_')
        if (self.hasButtons) self.buttonPressListeners.set(id, { buttonId, handlerId })
        return id
      },
      onButtonRelease(buttonId, handlerId) {
        const id = self.mintId('btnr_')
        if (self.hasButtons) self.buttonReleaseListeners.set(id, { buttonId, handlerId })
        return id
      },
      modifyButton(buttonId, changes) {
        world.setButtonConfig(buttonId, changes)
      },
      setButtonState(buttonId, state) {
        world.setButtonState(buttonId, state)
      },
      sendNotification(text, playerIds) {
        const targets = playerIds ?? [...self.attachedPlayerIds]
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
        world.setRoomVisible(roomIds, visible, playerIds)
      },
      addRule(playerId, text) {
        world.addPlayerRule(playerId, text)
        self.deps.sendToPlayer(playerId, { type: 'add_rule', text })
      },
      exitScenario() {
        self.deps.onExitScenario?.(self.id)
      },
      removeMap(mapInstanceId) {
        self.deps.removeMap(mapInstanceId)
      },
    }
  }
}

// Re-exported so downstream consumers can reach the event type without
// importing from GameScript.ts directly.
export type { ActiveVoteRegionChangeEvent }
