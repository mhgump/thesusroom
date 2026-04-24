import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type { GameScript, GameScriptContext } from '../../../react-three-capacitor/server/src/GameScript.js'

let _terminateCb: (() => void) | null = null

class Scenario3Script implements GameScript {
  private listenersRegistered = false

  onPlayerConnect(ctx: GameScriptContext, _playerId: string): void {
    ctx.toggleVoteRegion('s3_rzone', true)

    if (this.listenersRegistered) return
    this.listenersRegistered = true

    ctx.onButtonPress('btn_left', () => {
      ctx.sendNotification('Left pressed')
    })

    ctx.onButtonPress('btn_right', () => {
      ctx.sendNotification('Right pressed')
    })

    ctx.onVoteChanged(['s3_rzone'], (assignments) => {
      const count = [...assignments.values()].filter(r => r === 's3_rzone').length
      if (count === 1) {
        ctx.modifyButton('btn_right', { enableClientPress: true })
      } else {
        ctx.modifyButton('btn_right', { enableClientPress: false })
      }
    })
  }
}

export const SCENARIO: ScenarioSpec = {
  id: 'scenario3',
  timeoutMs: 60_000,
  onTerminate(cb) { _terminateCb = cb },
  scriptFactory: () => new Scenario3Script(),
}
