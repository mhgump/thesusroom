import { useGameStore } from '../store/gameStore'
import { reconnectWs } from '../network/useWebSocket'

export function EliminationOverlay() {
  const hp = useGameStore((s) => s.playerId ? (s.playerHp[s.playerId] ?? 2) : 2)
  const observerMode = useGameStore((s) => s.observerMode)
  const observerEndReason = useGameStore((s) => s.observerEndReason)

  const localEliminated = !observerMode && hp === 0
  const observerEnded = observerMode && observerEndReason !== 'none'

  if (!localEliminated && !observerEnded) return null

  const text =
    (localEliminated || observerEndReason === 'eliminated')
      ? 'ELIMINATED'
      : observerEndReason === 'replay_ended'
        ? 'RECORDING ENDED'
        : 'DISCONNECTED'

  return (
    <div
      onClick={localEliminated ? reconnectWs : undefined}
      onTouchEnd={localEliminated ? (e) => { e.preventDefault(); reconnectWs() } : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        pointerEvents: localEliminated ? 'auto' : 'none',
        cursor: localEliminated ? 'pointer' : 'default',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <span style={{
        color: '#e74c3c',
        fontSize: 'clamp(3.5rem, 14vw, 7rem)',
        fontWeight: 800,
        letterSpacing: '0.05em',
        fontFamily: 'system-ui, monospace',
      }}>
        {text}
      </span>
      {localEliminated && (
        <span style={{
          color: 'rgba(255,255,255,0.5)',
          fontSize: 'clamp(0.9rem, 3.5vw, 1.4rem)',
          fontFamily: 'system-ui, monospace',
          marginTop: '1.2em',
          letterSpacing: '0.08em',
        }}>
          TAP TO REJOIN
        </span>
      )}
    </div>
  )
}
