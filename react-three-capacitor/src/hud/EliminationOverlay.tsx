import { useGameStore } from '../store/gameStore'

export function EliminationOverlay() {
  const hp = useGameStore((s) => s.playerId ? (s.playerHp[s.playerId] ?? 2) : 2)

  if (hp !== 0) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      pointerEvents: 'none',
    }}>
      <span style={{
        color: '#e74c3c',
        fontSize: '3.5rem',
        fontWeight: 800,
        letterSpacing: '0.05em',
        fontFamily: 'system-ui, monospace',
      }}>
        ELIMINATED
      </span>
    </div>
  )
}
