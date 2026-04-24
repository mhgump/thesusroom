import { useGameStore } from '../store/gameStore'
import { useWsSend } from '../network/useWebSocket'

// Bottom-right ability panel. Renders up to 2 buttons for abilities the
// scenario has granted to the local player via `ability_grant`. Tapping a
// button fires `ability_use` back to the scenario. The server controls
// which abilities exist, when they appear, and what they do — the HUD is
// purely a surface for the granted list.
const MAX_ABILITIES_SHOWN = 2

export function AbilityBar() {
  const abilities = useGameStore((s) => s.abilities)
  const { sendAbilityUse } = useWsSend()
  if (abilities.length === 0) return null

  const visible = abilities.slice(0, MAX_ABILITIES_SHOWN)

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
        right: 'calc(28px + env(safe-area-inset-right, 0px))',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 10,
        pointerEvents: 'auto',
      }}
    >
      {visible.map((a) => (
        <button
          key={a.abilityId}
          onClick={() => sendAbilityUse(a.abilityId)}
          style={{
            width: 'clamp(64px, 12vw, 96px)',
            height: 'clamp(64px, 12vw, 96px)',
            borderRadius: '50%',
            border: `2px solid ${a.color ?? '#ffffff'}`,
            background: `${a.color ?? '#2ecc71'}cc`,
            color: '#ffffff',
            fontSize: 'clamp(11px, 1.8vw, 15px)',
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: 'system-ui, monospace',
            boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
