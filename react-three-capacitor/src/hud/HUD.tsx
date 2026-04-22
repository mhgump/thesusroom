import { useGameStore } from '../store/gameStore'
import { Joystick } from './Joystick'
import { Notifications } from './Notifications'
import { EliminationOverlay } from './EliminationOverlay'
import { ChoicePopup } from './ChoicePopup'
import { RulePopup } from './RulePopup'
import { DEFAULT_WORLD } from '../game/DefaultWorld'

export function HUD() {
  const { connected, currentRoomId } = useGameStore((s) => ({
    connected: s.connected,
    currentRoomId: s.currentRoomId,
  }))

  const roomName = DEFAULT_WORLD.rooms.find(r => r.id === currentRoomId)?.name ?? currentRoomId

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        fontFamily: 'system-ui, monospace',
        zIndex: 10,
      }}
    >
      {/* Status bar (top-right) */}
      <div
        style={{
          position: 'absolute',
          top: 'calc(12px + env(safe-area-inset-top, 0px))',
          right: 'calc(16px + env(safe-area-inset-right, 0px))',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: connected ? '#22ee88' : '#ee4444',
          }}
        />
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
          {roomName}
        </span>
      </div>

      <Notifications />
      <EliminationOverlay />
      <ChoicePopup />
      <RulePopup />

      {/* Joystick — bottom-left */}
      <div
        style={{
          position: 'absolute',
          bottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
          left: 'calc(28px + env(safe-area-inset-left, 0px))',
          pointerEvents: 'auto',
        }}
      >
        <Joystick />
      </div>
    </div>
  )
}
