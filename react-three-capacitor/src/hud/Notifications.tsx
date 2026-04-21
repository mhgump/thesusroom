import { useGameStore } from '../store/gameStore'

export function Notifications() {
  const notifications = useGameStore((s) => s.notifications)

  if (notifications.length === 0) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(50px + env(safe-area-inset-top, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
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
            padding: '6px 18px',
            borderRadius: 20,
            fontSize: 14,
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
