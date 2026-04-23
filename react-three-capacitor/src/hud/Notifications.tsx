import { useGameStore } from '../store/gameStore'

export function Notifications() {
  const notifications = useGameStore((s) => s.notifications)

  if (notifications.length === 0) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(clamp(36px, 6vh, 60px) + env(safe-area-inset-top, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'clamp(5px, 0.8vw, 10px)',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      {notifications.map((n) => (
        <div
          key={n.id}
          style={{
            background: 'rgba(0, 0, 0, 0.75)',
            color: 'white',
            padding: 'clamp(4px, 0.7vh, 8px) clamp(12px, 2vw, 22px)',
            borderRadius: 'clamp(14px, 2vw, 22px)',
            fontSize: 'clamp(11px, 1.8vw, 16px)',
            fontWeight: 'bold',
            letterSpacing: '0.02em',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            whiteSpace: 'nowrap',
          }}
        >
          {n.message}
        </div>
      ))}
    </div>
  )
}
