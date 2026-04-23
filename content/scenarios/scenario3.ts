import type { ScenarioSpec } from '../../react-three-capacitor/server/src/ScenarioRegistry.js'
import type { GameScript, GameScriptContext } from '../../react-three-capacitor/server/src/GameScript.js'

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

export const SCENARIO3_SCENARIO: ScenarioSpec = {
  id: 'scenario3',
  scriptFactory: () => new Scenario3Script(),
}
