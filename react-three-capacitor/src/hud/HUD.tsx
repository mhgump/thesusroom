import { useGameStore } from '../store/gameStore'
import { Joystick } from './Joystick'
import { ActionButtons } from './ActionButtons'
import { Notifications } from './Notifications'

export function HUD() {
  const { connected, currentRound } = useGameStore((s) => ({
    connected: s.connected,
    currentRound: s.currentRound,
  }))

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
          R{currentRound}
        </span>
      </div>

      {/* Touch notifications — vertical column, center top */}
      <Notifications />

      {/* Joystick — bottom-left, respects safe area */}
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

      {/* Action buttons — bottom-right */}
      <div
        style={{
          position: 'absolute',
          bottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
          right: 'calc(28px + env(safe-area-inset-right, 0px))',
          pointerEvents: 'auto',
        }}
      >
        <ActionButtons />
      </div>
    </div>
  )
}
