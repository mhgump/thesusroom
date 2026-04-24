import type { GameScript, GameScriptContext, ActiveVoteRegionChangeEvent } from './GameScript.js'
import type { VoteRegionSpec, InstructionEventSpec, FloorGeometrySpec, ButtonSpec, ButtonConfig, ButtonState, RuleLabel } from './GameSpec.js'
import type { World, WalkableArea, DamageEvent } from './World.js'
import { ButtonManager } from './ButtonManager.js'
import type { BotSpec } from './bot/BotTypes.js'

export class GameScriptManager {
  private readonly script: GameScript | null
  private readonly voteRegionSpecs: Map<string, VoteRegionSpec>
  private readonly instructionSpecs: Map<string, InstructionEventSpec>
  private readonly geometrySpecs: FloorGeometrySpec[]
  private readonly activeRegions: Set<string>
  private readonly playerRegions: Map<string, string | null> = new Map()
  private readonly playerGeometry: Map<string, Record<string, boolean>> = new Map()
  private readonly playerCurrentRoom: Map<string, string | null> = new Map()
  private readonly voteListeners: Array<{
    regionIds: Set<string>
    callback: (assignments: Map<string, string | null>) => void
  }> = []
  private readonly roomEnterListeners: Array<(playerId: string, roomId: string) => void> = []

  private readonly world: World
  private readonly sendInstruction: (playerId: string, lines: Array<{ text: string; label: RuleLabel; specId: string }>) => void
  private readonly removePlayer: (playerId: string, eliminated?: boolean) => void
  private readonly onCloseScenario: () => void
  private readonly sendGeometryState: (playerId: string, updates: Array<{ id: string; visible: boolean }>, perPlayer?: boolean) => void
  private readonly sendRoomVisibilityState: (playerId: string, updates: Array<{ roomId: string; visible: boolean }>, perPlayer?: boolean) => void
  private readonly globalRoomVisible: Map<string, boolean>
  private readonly playerRoomVisible: Map<string, Map<string, boolean>> = new Map()
  private readonly walkableVariants: Array<{ triggerIds: Set<string>; walkable: WalkableArea }>
  private readonly onWalkableUpdate: (area: WalkableArea) => void
  private readonly toggleVariants: Array<{ triggerIds: Set<string>; toggleIds: string[] }>
  private readonly onToggleUpdate: (toggleIds: string[]) => void
  private readonly globalGeomVisible: Map<string, boolean>
  private readonly getRoomAtPosition: ((x: number, z: number) => string | null) | undefined

  private readonly buttonManager: ButtonManager | null
  private readonly buttonPressListeners: Map<string, Array<(occupants: string[]) => void>> = new Map()
  private readonly buttonReleaseListeners: Map<string, Array<() => void>> = new Map()
  private readonly broadcastButtonState: (id: string, state: ButtonState, occupancy: number) => void
  private readonly broadcastButtonConfig: (id: string, changes: Partial<ButtonConfig>) => void
  private readonly sendButtonInit: (playerId: string, buttons: Array<ButtonSpec & { state: ButtonState; occupancy: number }>) => void
  private readonly sendNotificationToPlayer: (playerId: string, text: string) => void
  private readonly broadcastDamageEvent: (targetId: string, x: number, z: number, event: DamageEvent) => void
  private readonly spawnBotFn: (spec: BotSpec) => void
  private readonly broadcastActiveVoteRegions: (event: ActiveVoteRegionChangeEvent) => void
  private readonly onVoteAssignmentChange: (assignments: Map<string, string[]>) => void
  private readonly sendRule: (playerId: string, text: string) => void

  constructor(
    world: World,
    script: GameScript | null,
    voteRegions: VoteRegionSpec[],
    instructionSpecs: InstructionEventSpec[],
    geometry: FloorGeometrySpec[],
    initialVisibility: Record<string, boolean>,
    sendInstruction: (playerId: string, lines: Array<{ text: string; label: RuleLabel; specId: string }>) => void,
    removePlayer: (playerId: string, eliminated?: boolean) => void,
    onCloseScenario: () => void,
    sendGeometryState: (playerId: string, updates: Array<{ id: string; visible: boolean }>, perPlayer?: boolean) => void,
    initialRoomVisibility: Record<string, boolean> = {},
    sendRoomVisibilityState: (playerId: string, updates: Array<{ roomId: string; visible: boolean }>, perPlayer?: boolean) => void = () => {},
    walkableVariants: Array<{ triggerIds: string[]; walkable: WalkableArea }> = [],
    onWalkableUpdate: (area: WalkableArea) => void = () => {},
    toggleVariants: Array<{ triggerIds: string[]; toggleIds: string[] }> = [],
    onToggleUpdate: (toggleIds: string[]) => void = () => {},
    buttons: ButtonSpec[] = [],
    broadcastButtonState: (id: string, state: ButtonState, occupancy: number) => void = () => {},
    broadcastButtonConfig: (id: string, changes: Partial<ButtonConfig>) => void = () => {},
    sendButtonInit: (playerId: string, buttons: Array<ButtonSpec & { state: ButtonState; occupancy: number }>) => void = () => {},
    sendNotificationToPlayer: (playerId: string, text: string) => void = () => {},
    broadcastDamageEvent: (targetId: string, x: number, z: number, event: DamageEvent) => void = () => {},
    getRoomAtPosition?: (x: number, z: number) => string | null,
    spawnBotFn: (spec: BotSpec) => void = () => {},
    onActiveVoteRegionsChange: (event: ActiveVoteRegionChangeEvent) => void = () => {},
    onVoteAssignmentChange: (assignments: Map<string, string[]>) => void = () => {},
    sendRule: (playerId: string, text: string) => void = () => {},
  ) {
    this.world = world
    this.script = script
    this.voteRegionSpecs = new Map(voteRegions.map(r => [r.id, r]))
    this.instructionSpecs = new Map(instructionSpecs.map(s => [s.id, s]))
    this.geometrySpecs = geometry
    this.sendInstruction = sendInstruction
    this.removePlayer = removePlayer
    this.onCloseScenario = onCloseScenario
    this.sendGeometryState = sendGeometryState
    this.sendRoomVisibilityState = sendRoomVisibilityState
    this.globalRoomVisible = new Map(Object.entries(initialRoomVisibility))
    this.onWalkableUpdate = onWalkableUpdate
    this.walkableVariants = walkableVariants.map(v => ({ triggerIds: new Set(v.triggerIds), walkable: v.walkable }))
    this.toggleVariants = toggleVariants.map(v => ({ triggerIds: new Set(v.triggerIds), toggleIds: v.toggleIds }))
    this.onToggleUpdate = onToggleUpdate
    this.globalGeomVisible = new Map(geometry.map(g => [g.id, initialVisibility[g.id] ?? true]))
    for (const [id, visible] of this.globalGeomVisible) {
      if (!visible) this.world.toggleGeometryOff(id)
    }
    this.activeRegions = new Set()
    this.buttonManager = buttons.length > 0 ? new ButtonManager(buttons) : null
    this.broadcastButtonState = broadcastButtonState
    this.broadcastButtonConfig = broadcastButtonConfig
    this.sendButtonInit = sendButtonInit
    this.sendNotificationToPlayer = sendNotificationToPlayer
    this.broadcastDamageEvent = broadcastDamageEvent
    this.getRoomAtPosition = getRoomAtPosition
    this.spawnBotFn = spawnBotFn
    this.broadcastActiveVoteRegions = onActiveVoteRegionsChange
    this.onVoteAssignmentChange = onVoteAssignmentChange
    this.sendRule = sendRule
  }

  private emitVoteAssignments(): void {
    const assignments = new Map<string, string[]>()
    for (const regionId of this.activeRegions) assignments.set(regionId, [])
    for (const [pid, rid] of this.playerRegions) {
      if (rid && assignments.has(rid)) assignments.get(rid)!.push(pid)
    }
    this.onVoteAssignmentChange(assignments)
  }

  private checkWalkableVariants(): void {
    for (const v of this.walkableVariants) {
      if ([...v.triggerIds].every(id => this.globalGeomVisible.get(id) === true)) {
        this.onWalkableUpdate(v.walkable)
        return
      }
    }
  }

  private checkToggleVariants(): void {
    for (const v of this.toggleVariants) {
      if ([...v.triggerIds].every(id => this.globalGeomVisible.get(id) === true)) {
        this.onToggleUpdate(v.toggleIds)
      }
    }
  }

  onPlayerConnect(playerId: string): void {
    this.playerRegions.set(playerId, null)
    this.playerCurrentRoom.set(playerId, null)

    const geomState: Record<string, boolean> = {}
    for (const g of this.geometrySpecs) {
      geomState[g.id] = this.globalGeomVisible.get(g.id) ?? true
    }
    this.playerGeometry.set(playerId, geomState)

    if (this.geometrySpecs.length > 0) {
      this.sendGeometryState(playerId, this.geometrySpecs.map(g => ({ id: g.id, visible: geomState[g.id] })))
    }

    const roomVisState = new Map(this.globalRoomVisible)
    this.playerRoomVisible.set(playerId, roomVisState)
    if (roomVisState.size > 0) {
      this.sendRoomVisibilityState(playerId, [...roomVisState].map(([roomId, visible]) => ({ roomId, visible })))
    }

    const buttonData = this.buttonManager?.getInitData() ?? []
    if (buttonData.length > 0) {
      this.sendButtonInit(playerId, buttonData)
    }

    if (this.script) {
      this.script.onPlayerConnect(this.makeContext(), playerId)
    }
  }

  onPlayerDisconnect(playerId: string): void {
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
    const p = this.world.getPlayer(playerId)
    if (!p) return

    const oldRegion = this.playerRegions.get(playerId) ?? null
    const newRegion = this.regionAt(p.x, p.z)
    if (newRegion !== oldRegion) {
      this.playerRegions.set(playerId, newRegion)
      this.notifyListeners(oldRegion, newRegion)
    }

    if (this.buttonManager) {
      const changes = this.buttonManager.updatePlayerPosition(playerId, p.x, p.z)
      for (const { buttonId } of changes) this.evaluateButton(buttonId)
    }

    if (this.getRoomAtPosition) {
      const oldRoom = this.playerCurrentRoom.get(playerId) ?? null
      const newRoom = this.getRoomAtPosition(p.x, p.z)
      if (newRoom !== null && newRoom !== oldRoom) {
        this.playerCurrentRoom.set(playerId, newRoom)
        // Keep the world's per-player room state aligned so accessible-rooms
        // resolution (World.getAccessibleRooms) reflects the current room.
        this.world.setPlayerRoom(playerId, newRoom)
        for (const cb of this.roomEnterListeners) cb(playerId, newRoom)
      }
    }
  }

  private evaluateButton(buttonId: string): void {
    const bm = this.buttonManager!
    const state = bm.getState(buttonId)
    const occupants = bm.getOccupants(buttonId)
    const config = bm.getConfig(buttonId)
    if (state === undefined || !occupants || !config) return

    if (state === 'idle' && occupants.size >= config.requiredPlayers) {
      bm.setState(buttonId, 'pressed')
      this.broadcastButtonState(buttonId, 'pressed', occupants.size)
      const list = [...occupants]
      for (const cb of this.buttonPressListeners.get(buttonId) ?? []) cb(list)
      return
    }

    if (state === 'pressed' && !config.holdAfterRelease && occupants.size < config.requiredPlayers) {
      for (const cb of this.buttonReleaseListeners.get(buttonId) ?? []) cb()
      if (config.cooldownMs > 0) {
        bm.startCooldown(buttonId, config.cooldownMs, () => {
          bm.setState(buttonId, 'idle')
          this.broadcastButtonState(buttonId, 'idle', bm.getOccupants(buttonId)!.size)
        })
        this.broadcastButtonState(buttonId, 'cooldown', occupants.size)
      } else {
        bm.setState(buttonId, 'idle')
        this.broadcastButtonState(buttonId, 'idle', occupants.size)
      }
      return
    }

    this.broadcastButtonState(buttonId, state, occupants.size)
  }

  private regionAt(x: number, z: number): string | null {
    for (const [id, r] of this.voteRegionSpecs) {
      if (!this.activeRegions.has(id)) continue
      if (Math.hypot(x - r.x, z - r.z) <= r.radius) return id
    }
    return null
  }

  private notifyListeners(oldRegion: string | null, newRegion: string | null): void {
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
    return {
      sendInstruction(playerId, specId) {
        const spec = self.instructionSpecs.get(specId)
        if (spec) self.sendInstruction(playerId, [{ text: spec.text, label: spec.label, specId }])
      },
      sendInstructions(playerId, specIds) {
        const lines = specIds
          .map(id => self.instructionSpecs.get(id))
          .filter((s): s is InstructionEventSpec => s !== undefined)
          .map(s => ({ text: s.text, label: s.label, specId: s.id }))
        if (lines.length > 0) self.sendInstruction(playerId, lines)
      },
      toggleVoteRegion(regionId, active) {
        if (active) self.activeRegions.add(regionId)
        else self.activeRegions.delete(regionId)
        self.broadcastActiveVoteRegions({ type: 'active_vote_region_change', activeIds: [...self.activeRegions] })
        self.emitVoteAssignments()
      },
      onVoteChanged(regionIds, callback) {
        self.voteListeners.push({ regionIds: new Set(regionIds), callback })
      },
      after(durationMs, callback) {
        const t = setTimeout(callback, durationMs)
        return () => clearTimeout(t)
      },
      getPlayerIds() {
        return [...self.playerRegions.keys()]
      },
      getPlayerPosition(playerId) {
        const p = self.world.getPlayer(playerId)
        return p ? { x: p.x, z: p.z } : null
      },
      eliminatePlayer(playerId) {
        self.removePlayer(playerId, true)
      },
      closeScenario() {
        self.onCloseScenario()
      },
      setGeometryVisible(geometryIds, visible, playerIds) {
        const perPlayer = !!(playerIds && playerIds.length > 0)
        const targets = perPlayer
          ? playerIds!
          : [...self.playerGeometry.keys()]
        const updates = geometryIds.map(id => ({ id, visible }))
        for (const pid of targets) {
          const geom = self.playerGeometry.get(pid)
          if (!geom) continue
          for (const id of geometryIds) geom[id] = visible
          self.sendGeometryState(pid, updates, perPlayer)
        }
        if (!playerIds || playerIds.length === 0) {
          for (const id of geometryIds) {
            self.globalGeomVisible.set(id, visible)
            if (visible) self.world.toggleGeometryOn(id)
            else self.world.toggleGeometryOff(id)
          }
          self.checkWalkableVariants()
          self.checkToggleVariants()
        } else {
          for (const pid of targets) {
            for (const id of geometryIds) {
              if (visible) self.world.toggleGeometryOn(id, pid)
              else self.world.toggleGeometryOff(id, pid)
            }
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
        self.broadcastButtonConfig(buttonId, changes)
        self.evaluateButton(buttonId)
      },
      setButtonState(buttonId, state) {
        if (!self.buttonManager) return
        self.buttonManager.setState(buttonId, state)
        const occupants = self.buttonManager.getOccupants(buttonId)
        self.broadcastButtonState(buttonId, state, occupants?.size ?? 0)
      },
      sendNotification(text, playerIds) {
        const targets = playerIds ?? [...self.playerRegions.keys()]
        for (const pid of targets) self.sendNotificationToPlayer(pid, text)
      },
      applyDamage(playerId, amount) {
        const event = self.world.applyDamage(playerId, amount)
        if (!event) return
        const p = self.world.getPlayer(playerId)
        if (p) self.broadcastDamageEvent(playerId, p.x, p.z, event)
        if (event.newHp === 0) self.removePlayer(playerId, true)
      },
      onPlayerEnterRoom(callback) {
        self.roomEnterListeners.push(callback)
      },
      spawnBot(spec) {
        for (const key of Object.keys(spec.onInstructMap)) {
          if (!self.instructionSpecs.has(key)) {
            throw new Error(`[BotSpec] onInstructMap key "${key}" is not a valid instruction spec id for this scenario`)
          }
        }
        self.spawnBotFn(spec)
      },
      lockPlayerToRoom(playerId) {
        self.world.lockCurrentRoom(playerId)
      },
      unlockPlayerFromRoom(playerId) {
        self.world.unlockPlayerFromRoom(playerId)
      },
      setRoomVisible(roomIds, visible, playerIds) {
        const perPlayer = !!(playerIds && playerIds.length > 0)
        const targets = perPlayer ? playerIds! : [...self.playerRoomVisible.keys()]
        const updates = roomIds.map(roomId => ({ roomId, visible }))
        for (const pid of targets) {
          const state = self.playerRoomVisible.get(pid)
          if (!state) continue
          for (const roomId of roomIds) state.set(roomId, visible)
          self.sendRoomVisibilityState(pid, updates, perPlayer)
        }
        if (!perPlayer) {
          for (const roomId of roomIds) self.globalRoomVisible.set(roomId, visible)
        }
      },
      addRule(playerId, text) {
        self.world.addPlayerRule(playerId, text)
        self.sendRule(playerId, text)
      },
    }
  }

  // Returns the current game state for the given observed player without modifying any state.
  // Used to send a snapshot to an observer joining mid-game.
  getPlayerSnapshotData(observedPlayerId: string): {
    geometryUpdates: Array<{ id: string; visible: boolean }> | null
    roomVisibilityUpdates: Array<{ roomId: string; visible: boolean }> | null
    buttonData: Array<ButtonSpec & { state: ButtonState; occupancy: number }>
    voteAssignments: Record<string, string[]> | null
  } {
    let geometryUpdates: Array<{ id: string; visible: boolean }> | null = null
    if (this.geometrySpecs.length > 0) {
      const geomState = this.playerGeometry.get(observedPlayerId)
      geometryUpdates = this.geometrySpecs.map(g => ({
        id: g.id,
        visible: geomState ? (geomState[g.id] ?? true) : (this.globalGeomVisible.get(g.id) ?? true),
      }))
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
}
