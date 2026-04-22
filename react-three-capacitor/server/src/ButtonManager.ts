import type { ButtonSpec, ButtonConfig, ButtonState } from './GameSpec.js'

interface ButtonEntry {
  spec: ButtonSpec
  config: ButtonConfig
  state: ButtonState
  occupants: Set<string>
  cooldownTimer: ReturnType<typeof setTimeout> | null
}

export interface ButtonOccupancyChange { buttonId: string }

export class ButtonManager {
  private readonly buttons: Map<string, ButtonEntry> = new Map()

  constructor(specs: ButtonSpec[]) {
    for (const spec of specs) {
      const { requiredPlayers, holdAfterRelease, cooldownMs, enableClientPress } = spec
      this.buttons.set(spec.id, {
        spec,
        config: { requiredPlayers, holdAfterRelease, cooldownMs, enableClientPress },
        state: spec.initialState ?? 'idle',
        occupants: new Set(),
        cooldownTimer: null,
      })
    }
  }

  updatePlayerPosition(playerId: string, x: number, z: number): ButtonOccupancyChange[] {
    const changes: ButtonOccupancyChange[] = []
    for (const [id, entry] of this.buttons) {
      const wasIn = entry.occupants.has(playerId)
      const isIn = Math.hypot(x - entry.spec.x, z - entry.spec.z) <= entry.spec.triggerRadius
      if (isIn && !wasIn) { entry.occupants.add(playerId); changes.push({ buttonId: id }) }
      else if (!isIn && wasIn) { entry.occupants.delete(playerId); changes.push({ buttonId: id }) }
    }
    return changes
  }

  removePlayer(playerId: string): ButtonOccupancyChange[] {
    const changes: ButtonOccupancyChange[] = []
    for (const [id, entry] of this.buttons) {
      if (entry.occupants.has(playerId)) {
        entry.occupants.delete(playerId)
        changes.push({ buttonId: id })
      }
    }
    return changes
  }

  setState(buttonId: string, state: ButtonState): void {
    const entry = this.buttons.get(buttonId)
    if (!entry) return
    if (entry.cooldownTimer) { clearTimeout(entry.cooldownTimer); entry.cooldownTimer = null }
    entry.state = state
  }

  patchConfig(buttonId: string, changes: Partial<ButtonConfig>): void {
    const entry = this.buttons.get(buttonId)
    if (entry) Object.assign(entry.config, changes)
  }

  startCooldown(buttonId: string, durationMs: number, onComplete: () => void): void {
    const entry = this.buttons.get(buttonId)
    if (!entry) return
    entry.state = 'cooldown'
    if (entry.cooldownTimer) clearTimeout(entry.cooldownTimer)
    entry.cooldownTimer = setTimeout(() => {
      entry.cooldownTimer = null
      onComplete()
    }, durationMs)
  }

  getState(buttonId: string): ButtonState | undefined {
    return this.buttons.get(buttonId)?.state
  }

  getOccupants(buttonId: string): Set<string> | undefined {
    return this.buttons.get(buttonId)?.occupants
  }

  getConfig(buttonId: string): ButtonConfig | undefined {
    return this.buttons.get(buttonId)?.config
  }

  // Returns full current snapshot for button_init message.
  getInitData(): Array<ButtonSpec & { state: ButtonState; occupancy: number }> {
    return [...this.buttons.values()].map(e => ({
      ...e.spec,
      ...e.config,
      state: e.state,
      occupancy: e.occupants.size,
    }))
  }
}
