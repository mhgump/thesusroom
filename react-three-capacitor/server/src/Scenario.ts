import type { GameScript, GameScriptContext, ActiveVoteRegionChangeEvent } from './GameScript.js'
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
  spawnBot: (spec: BotSpec) => void
  scheduleSimMs: (ms: number, cb: () => void) => () => void
  // Resolves a world position to a scoped room id (from the attached map).
  getRoomAtPosition?: (x: number, z: number) => string | null
  getServerTick: () => number
}

// The per-instance configuration a Scenario is constructed with. Most of it
// comes from the ScenarioSpec + attached map's GameSpec; the list of attached
// inner-world rooms is passed in separately so scenarios can be scoped to a
// subset of a World's map instance.
export interface ScenarioConfig {
  id: string
  script: GameScript | null
  gameSpec: GameSpec | null
  // Initial globally-visible state for each geometry id the scenario cares
  // about. Unknown keys are allowed — any id not listed here is treated as
  // "on" (solid) by default until the scenario toggles it.
  initialVisibility: Record<string, boolean>
  initialRoomVisibility: Record<string, boolean>
  requiredRoomIds?: string[]
}

export class Scenario {
  readonly id: string
  private readonly script: GameScript | null
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

  private readonly voteListeners: Array<{
    regionIds: Set<string>
    callback: (assignments: Map<string, string | null>) => void
  }> = []
  private readonly roomEnterListeners: Array<(playerId: string, roomId: string) => void> = []
  private readonly buttonPressListeners: Map<string, Array<(occupants: string[]) => void>> = new Map()
  private readonly buttonReleaseListeners: Map<string, Array<() => void>> = new Map()

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
      this.script.onPlayerConnect(this.ctx, pid)
    }
    if (this.script.onPlayerReady) {
      for (const pid of this.readyPlayerIds) {
        this.script.onPlayerReady(this.ctx, pid)
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
      this.script.onPlayerConnect(this.ctx, playerId)
    }
  }

  onPlayerReady(playerId: string): void {
    if (!this.alive) return
    if (!this.attachedPlayerIds.has(playerId)) return
    if (this.readyPlayerIds.has(playerId)) return
    this.readyPlayerIds.add(playerId)
    if (!this.script?.onPlayerReady) return
    if (!this.started) return
    this.script.onPlayerReady(this.ctx, playerId)
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
        for (const cb of this.roomEnterListeners) cb(playerId, newRoom)
      }
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

  // Wraps sim-ms scheduler with an alive-gate. Callbacks queued before
  // delete() but dispatched after are dropped.
  private scheduleScoped(ms: number, cb: () => void): () => void {
    return this.deps.scheduleSimMs(ms, () => { if (this.alive) cb() })
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
      const list = [...occupants]
      for (const cb of this.buttonPressListeners.get(buttonId) ?? []) cb(list)
      return
    }

    if (state === 'pressed' && !config.holdAfterRelease && occupants.size < config.requiredPlayers) {
      for (const cb of this.buttonReleaseListeners.get(buttonId) ?? []) cb()
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
    const assignments = new Map(this.playerRegions)
    for (const listener of this.voteListeners) {
      if ([...changed].some(r => listener.regionIds.has(r))) {
        listener.callback(assignments)
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
      onVoteChanged(regionIds, callback) {
        self.voteListeners.push({ regionIds: new Set(regionIds), callback })
      },
      after(durationMs, callback) {
        return self.scheduleScoped(durationMs, callback)
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
      onButtonPress(buttonId, callback) {
        if (!self.buttonManager) return () => {}
        const list = self.buttonPressListeners.get(buttonId) ?? []
        self.buttonPressListeners.set(buttonId, list)
        list.push(callback)
        return () => { const i = list.indexOf(callback); if (i >= 0) list.splice(i, 1) }
      },
      onButtonRelease(buttonId, callback) {
        if (!self.buttonManager) return () => {}
        const list = self.buttonReleaseListeners.get(buttonId) ?? []
        self.buttonReleaseListeners.set(buttonId, list)
        list.push(callback)
        return () => { const i = list.indexOf(callback); if (i >= 0) list.splice(i, 1) }
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
      onPlayerEnterRoom(callback) {
        self.roomEnterListeners.push(callback)
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
