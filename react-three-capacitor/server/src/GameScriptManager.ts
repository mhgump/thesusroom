import type { GameScript, GameScriptContext } from './GameScript.js'
import type { VoteRegionSpec, InstructionEventSpec } from './GameSpec.js'
import type { World } from './World.js'

export class GameScriptManager {
  private readonly script: GameScript | null
  private readonly voteRegionSpecs: Map<string, VoteRegionSpec>
  private readonly instructionSpecs: Map<string, InstructionEventSpec>
  private readonly activeRegions: Set<string> = new Set()
  private readonly playerRegions: Map<string, string | null> = new Map()
  private readonly voteListeners: Array<{
    regionIds: Set<string>
    callback: (assignments: Map<string, string | null>) => void
  }> = []

  private readonly world: World
  private readonly sendInstruction: (playerId: string, text: string) => void
  private readonly removePlayer: (playerId: string) => void

  constructor(
    world: World,
    script: GameScript | null,
    voteRegions: VoteRegionSpec[],
    instructionSpecs: InstructionEventSpec[],
    sendInstruction: (playerId: string, text: string) => void,
    removePlayer: (playerId: string) => void,
  ) {
    this.world = world
    this.script = script
    this.voteRegionSpecs = new Map(voteRegions.map(r => [r.id, r]))
    this.instructionSpecs = new Map(instructionSpecs.map(s => [s.id, s]))
    this.sendInstruction = sendInstruction
    this.removePlayer = removePlayer
  }

  onPlayerConnect(playerId: string): void {
    this.playerRegions.set(playerId, null)
    if (this.script) {
      this.script.onPlayerConnect(this.makeContext(), playerId)
    }
  }

  onPlayerDisconnect(playerId: string): void {
    this.playerRegions.delete(playerId)
  }

  // Called after each processMove for a player still present in the room.
  onPlayerMoved(playerId: string): void {
    const p = this.world.getPlayer(playerId)
    if (!p) return
    const oldRegion = this.playerRegions.get(playerId) ?? null
    const newRegion = this.regionAt(p.x, p.z)
    if (newRegion !== oldRegion) {
      this.playerRegions.set(playerId, newRegion)
      this.notifyListeners(oldRegion, newRegion)
    }
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
        if (spec) self.sendInstruction(playerId, spec.text)
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
    }
  }
}
