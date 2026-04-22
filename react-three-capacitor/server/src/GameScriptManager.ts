import type { GameScript, GameScriptContext } from './GameScript.js'
import type { VoteRegionSpec, InstructionEventSpec, FloorGeometrySpec, ButtonSpec, ButtonConfig, ButtonState } from './GameSpec.js'
import type { World, WalkableArea } from './World.js'
import { ButtonManager } from './ButtonManager.js'

export class GameScriptManager {
  private readonly script: GameScript | null
  private readonly voteRegionSpecs: Map<string, VoteRegionSpec>
  private readonly instructionSpecs: Map<string, InstructionEventSpec>
  private readonly geometrySpecs: FloorGeometrySpec[]
  private readonly initialVisibility: Record<string, boolean>
  private readonly activeRegions: Set<string>
  private readonly playerRegions: Map<string, string | null> = new Map()
  private readonly playerGeometry: Map<string, Record<string, boolean>> = new Map()
  private readonly voteListeners: Array<{
    regionIds: Set<string>
    callback: (assignments: Map<string, string | null>) => void
  }> = []

  private readonly world: World
  private readonly sendInstruction: (playerId: string, text: string, label: string) => void
  private readonly removePlayer: (playerId: string) => void
  private readonly onCloseScenario: () => void
  private readonly sendGeometryState: (playerId: string, updates: Array<{ id: string; visible: boolean }>) => void
  private readonly walkableVariants: Array<{ triggerIds: Set<string>; walkable: WalkableArea }>
  private readonly onWalkableUpdate: (area: WalkableArea) => void
  private readonly globalGeomVisible: Map<string, boolean>

  private readonly buttonManager: ButtonManager | null
  private readonly buttonPressListeners: Map<string, Array<(occupants: string[]) => void>> = new Map()
  private readonly buttonReleaseListeners: Map<string, Array<() => void>> = new Map()
  private readonly broadcastButtonState: (id: string, state: ButtonState, occupancy: number) => void
  private readonly broadcastButtonConfig: (id: string, changes: Partial<ButtonConfig>) => void
  private readonly sendButtonInit: (playerId: string, buttons: Array<ButtonSpec & { state: ButtonState; occupancy: number }>) => void
  private readonly sendNotificationToPlayer: (playerId: string, text: string) => void

  constructor(
    world: World,
    script: GameScript | null,
    voteRegions: VoteRegionSpec[],
    instructionSpecs: InstructionEventSpec[],
    geometry: FloorGeometrySpec[],
    initialVisibility: Record<string, boolean>,
    sendInstruction: (playerId: string, text: string, label: string) => void,
    removePlayer: (playerId: string) => void,
    onCloseScenario: () => void,
    sendGeometryState: (playerId: string, updates: Array<{ id: string; visible: boolean }>) => void,
    walkableVariants: Array<{ triggerIds: string[]; walkable: WalkableArea }> = [],
    onWalkableUpdate: (area: WalkableArea) => void = () => {},
    buttons: ButtonSpec[] = [],
    broadcastButtonState: (id: string, state: ButtonState, occupancy: number) => void = () => {},
    broadcastButtonConfig: (id: string, changes: Partial<ButtonConfig>) => void = () => {},
    sendButtonInit: (playerId: string, buttons: Array<ButtonSpec & { state: ButtonState; occupancy: number }>) => void = () => {},
    sendNotificationToPlayer: (playerId: string, text: string) => void = () => {},
  ) {
    this.world = world
    this.script = script
    this.voteRegionSpecs = new Map(voteRegions.map(r => [r.id, r]))
    this.instructionSpecs = new Map(instructionSpecs.map(s => [s.id, s]))
    this.geometrySpecs = geometry
    this.initialVisibility = initialVisibility
    this.sendInstruction = sendInstruction
    this.removePlayer = removePlayer
    this.onCloseScenario = onCloseScenario
    this.sendGeometryState = sendGeometryState
    this.onWalkableUpdate = onWalkableUpdate
    this.walkableVariants = walkableVariants.map(v => ({ triggerIds: new Set(v.triggerIds), walkable: v.walkable }))
    this.globalGeomVisible = new Map(geometry.map(g => [g.id, initialVisibility[g.id] ?? true]))
    this.activeRegions = new Set(
      voteRegions.filter(r => initialVisibility[r.id] === true).map(r => r.id)
    )
    this.buttonManager = buttons.length > 0 ? new ButtonManager(buttons) : null
    this.broadcastButtonState = broadcastButtonState
    this.broadcastButtonConfig = broadcastButtonConfig
    this.sendButtonInit = sendButtonInit
    this.sendNotificationToPlayer = sendNotificationToPlayer
  }

  private checkWalkableVariants(): void {
    for (const v of this.walkableVariants) {
      if ([...v.triggerIds].every(id => this.globalGeomVisible.get(id) === true)) {
        this.onWalkableUpdate(v.walkable)
        return
      }
    }
  }

  onPlayerConnect(playerId: string): void {
    this.playerRegions.set(playerId, null)

    const geomState: Record<string, boolean> = {}
    for (const g of this.geometrySpecs) {
      geomState[g.id] = this.initialVisibility[g.id] ?? true
    }
    this.playerGeometry.set(playerId, geomState)

    if (this.geometrySpecs.length > 0) {
      this.sendGeometryState(playerId, this.geometrySpecs.map(g => ({ id: g.id, visible: geomState[g.id] })))
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
    this.playerGeometry.delete(playerId)
    if (this.buttonManager) {
      const changes = this.buttonManager.removePlayer(playerId)
      for (const { buttonId } of changes) this.evaluateButton(buttonId)
    }
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
  }

  // Called by GameScriptManager whenever occupancy changes for a button.
  // Evaluates press/release criteria and drives state transitions.
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

    // Occupancy changed without a state transition — broadcast updated count.
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
  }

  private makeContext(): GameScriptContext {
    const self = this
    return {
      sendInstruction(playerId, specId) {
        const spec = self.instructionSpecs.get(specId)
        if (spec) self.sendInstruction(playerId, spec.text, spec.label)
      },
      toggleVoteRegion(regionId, active) {
        if (active) self.activeRegions.add(regionId)
        else self.activeRegions.delete(regionId)
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
        self.removePlayer(playerId)
      },
      closeScenario() {
        self.onCloseScenario()
      },
      setGeometryVisible(geometryIds, visible, playerIds) {
        const targets = playerIds && playerIds.length > 0
          ? playerIds
          : [...self.playerGeometry.keys()]
        const updates = geometryIds.map(id => ({ id, visible }))
        for (const pid of targets) {
          const geom = self.playerGeometry.get(pid)
          if (!geom) continue
          for (const id of geometryIds) geom[id] = visible
          self.sendGeometryState(pid, updates)
        }
        if (!playerIds || playerIds.length === 0) {
          for (const id of geometryIds) self.globalGeomVisible.set(id, visible)
          self.checkWalkableVariants()
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
    }
  }
}
