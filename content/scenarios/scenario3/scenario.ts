import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type {
  GameScript,
  VoteChangedPayload,
} from '../../../react-three-capacitor/server/src/GameScript.js'

interface S3State {
  listenersRegistered: boolean
}

const script: GameScript<S3State> = {
  initialState: () => ({ listenersRegistered: false }),

  onPlayerConnect(state, ctx) {
    ctx.toggleVoteRegion('s3_rzone', true)

    if (state.listenersRegistered) return
    state.listenersRegistered = true

    ctx.onButtonPress('btn_left', 'onLeftPress')
    ctx.onButtonPress('btn_right', 'onRightPress')
    ctx.onVoteChanged(['s3_rzone'], 'onVoteChanged')
  },

  handlers: {
    onLeftPress(_state, ctx) {
      ctx.sendNotification('Left pressed')
    },

    onRightPress(_state, ctx) {
      ctx.sendNotification('Right pressed')
    },

    onVoteChanged(_state, ctx, payload: VoteChangedPayload) {
      const count = Object.values(payload.assignments).filter(r => r === 's3_rzone').length
      if (count === 1) {
        ctx.modifyButton('btn_right', { enableClientPress: true })
      } else {
        ctx.modifyButton('btn_right', { enableClientPress: false })
      }
    },
  },
}

export const SCENARIO: ScenarioSpec = {
  id: 'scenario3',
  timeoutMs: 60_000,
  maxPlayers: 4,
  script,
  hubConnection: {
    mainRoomId: 'main',
    dockGeometryId: 's3_ws',
  },
}
