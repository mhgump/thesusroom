import type { Scenario } from './Scenario.js'

// Owns the live set of scenarios attached to a MultiplayerRoom and tracks
// which scenario each player is attached to. Per scenario, lifecycle is
// created (via add) → started (via start) → deleted (via delete). "Paused"
// is not a state.
export class ScenarioManager {
  private readonly scenarios: Map<string, Scenario> = new Map()
  private readonly playerAttachment: Map<string, string> = new Map()
  private defaultOpenScenarioId: string | null = null

  add(scenario: Scenario, opts?: { default?: boolean }): void {
    if (this.scenarios.has(scenario.id)) {
      throw new Error(`Scenario '${scenario.id}' already added`)
    }
    this.scenarios.set(scenario.id, scenario)
    if (opts?.default) this.defaultOpenScenarioId = scenario.id
  }

  start(scenarioId: string): void {
    const scenario = this.scenarios.get(scenarioId)
    if (!scenario) throw new Error(`Scenario '${scenarioId}' not found`)
    scenario.start()
  }

  // Tear down a scenario: detach all its attached players (so their bookkeeping
  // clears), then terminate the scenario. Scheduled callbacks owned by the
  // scenario stop firing.
  delete(scenarioId: string): void {
    const scenario = this.scenarios.get(scenarioId)
    if (!scenario) return
    const attached = [...this.playerAttachment.entries()]
      .filter(([, sid]) => sid === scenarioId)
      .map(([pid]) => pid)
    for (const pid of attached) {
      scenario.onPlayerDetach(pid)
      this.playerAttachment.delete(pid)
    }
    scenario.delete()
    this.scenarios.delete(scenarioId)
    if (this.defaultOpenScenarioId === scenarioId) {
      this.defaultOpenScenarioId = null
    }
  }

  getDefaultOpen(): Scenario | null {
    if (!this.defaultOpenScenarioId) return null
    return this.scenarios.get(this.defaultOpenScenarioId) ?? null
  }

  // Clears the default-open designation (e.g. when `ctx.closeScenario()` runs).
  // The scenario itself is not deleted; its already-attached players continue.
  closeDefaultOpen(scenarioId: string): void {
    if (this.defaultOpenScenarioId === scenarioId) {
      this.defaultOpenScenarioId = null
    }
  }

  hasDefaultOpen(): boolean {
    return this.defaultOpenScenarioId !== null
  }

  forPlayer(playerId: string): Scenario | null {
    const sid = this.playerAttachment.get(playerId)
    if (!sid) return null
    return this.scenarios.get(sid) ?? null
  }

  attachPlayerToDefault(playerId: string): Scenario | null {
    const scenario = this.getDefaultOpen()
    if (!scenario) return null
    this.playerAttachment.set(playerId, scenario.id)
    scenario.onPlayerAttach(playerId)
    return scenario
  }

  attachPlayerTo(playerId: string, scenarioId: string): Scenario | null {
    const scenario = this.scenarios.get(scenarioId)
    if (!scenario) return null
    this.playerAttachment.set(playerId, scenarioId)
    scenario.onPlayerAttach(playerId)
    return scenario
  }

  detachPlayer(playerId: string): void {
    const sid = this.playerAttachment.get(playerId)
    if (!sid) return
    const scenario = this.scenarios.get(sid)
    scenario?.onPlayerDetach(playerId)
    this.playerAttachment.delete(playerId)
  }

  onPlayerMoved(playerId: string): void {
    this.forPlayer(playerId)?.onPlayerMoved(playerId)
  }

  // Tear-down hook called by the enclosing room when it's being destroyed.
  // Deletes every scenario in creation order.
  destroyAll(): void {
    for (const id of [...this.scenarios.keys()]) this.delete(id)
  }

  // Snapshot accessor for observer connection handling.
  all(): Scenario[] {
    return [...this.scenarios.values()]
  }
}
