import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ScenarioRegistry.js'
import type { GameScript, GameScriptContext } from '../../../react-three-capacitor/server/src/GameScript.js'
import { DEMO_BOT } from '../bots/demo/demoBot.js'

const BOT_FILL_DELAY_MS  = 10_000
const MOVE_WARN_DELAY_MS = 10_000
const ELIM_DELAY_MS      = 10_000
const FACT_DELAY_MS      = 1_000

class DemoScript implements GameScript {
  private botTimerSet = false
  private doorOpened = false
  private readonly inRoom2 = new Set<string>()
  private allInRoom2Triggered = false

  onPlayerConnect(ctx: GameScriptContext, _playerId: string): void {
    if (!this.botTimerSet) {
      this.botTimerSet = true
      ctx.after(BOT_FILL_DELAY_MS, () => {
        if (this.doorOpened) return
        const needed = 4 - ctx.getPlayerIds().length
        for (let i = 0; i < needed; i++) ctx.spawnBot(DEMO_BOT)
      })
    }

    if (ctx.getPlayerIds().length >= 4 && !this.doorOpened) {
      this.doorOpened = true
      ctx.closeScenario()
      ctx.setGeometryVisible(['north_door'], false)
      ctx.setGeometryVisible(['door_open'], true)

      ctx.onPlayerEnterRoom((pid, roomId) => {
        if (roomId !== 'room2') return
        this.inRoom2.add(pid)
        ctx.setGeometryVisible(['north_door'], true, [pid])
        this.checkAllInRoom2(ctx)
      })

      ctx.after(MOVE_WARN_DELAY_MS, () => {
        const living = ctx.getPlayerIds()
        const inRoom1 = living.filter(p => !this.inRoom2.has(p))
        for (const pid of inRoom1) ctx.sendInstruction(pid, 'rule_move')
        ctx.after(ELIM_DELAY_MS, () => {
          for (const pid of ctx.getPlayerIds()) {
            if (!this.inRoom2.has(pid)) ctx.eliminatePlayer(pid)
          }
          this.checkAllInRoom2(ctx)
        })
      })
    }
  }

  private checkAllInRoom2(ctx: GameScriptContext): void {
    if (this.allInRoom2Triggered) return
    const living = ctx.getPlayerIds()
    if (living.length === 0) return
    if (!living.every(p => this.inRoom2.has(p))) return
    this.allInRoom2Triggered = true
    ctx.after(FACT_DELAY_MS, () => {
      const survivors = ctx.getPlayerIds().length
      if (survivors === 0) return
      const specId = `fact_${survivors}`
      for (const pid of ctx.getPlayerIds()) ctx.sendInstruction(pid, specId)
    })
  }
}

export const DEMO_SCENARIO: ScenarioSpec = {
  id: 'demo',
  mapId: 'demo',
  instructionSpecs: [
    { id: 'rule_move', text: 'Players that do not continue will be eliminated', label: 'RULE' },
    { id: 'fact_1',   text: '1 player survived',  label: 'FACT' },
    { id: 'fact_2',   text: '2 players survived', label: 'FACT' },
    { id: 'fact_3',   text: '3 players survived', label: 'FACT' },
    { id: 'fact_4',   text: '4 players survived', label: 'FACT' },
  ],
  scriptFactory: () => new DemoScript(),
  initialVisibility: {
    'door_open': false,
  },
}
