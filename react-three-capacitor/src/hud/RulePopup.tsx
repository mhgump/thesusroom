import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'

const RULE_COLORS = [
  '#1A4A8A',
  '#1D6A40',
  '#7B1A2A',
  '#0D5959',
  '#4A1A6A',
]

export function RulePopup() {
  const event = useGameStore((s) => s.activeRuleEvent)
  const dismissRule = useGameStore((s) => s.dismissRule)

  useEffect(() => {
    if (!event) return
    const handler = () => dismissRule()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [event, dismissRule])

  if (!event?.rules) return null

  const count = event.rules.length
  const columns = count >= 4 ? 2 : 1
  const rows = count <= 3 ? count : Math.ceil(count / 2)

  return (
    <>
      <style>{`
        .rule-close-btn:hover { opacity: 1 !important; }
      `}</style>
      <div
        onClick={dismissRule}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          zIndex: 200,
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, monospace',
          cursor: 'pointer',
        }}
      >
        <button
          className="rule-close-btn"
          onClick={dismissRule}
          style={{
            position: 'absolute',
            top: '16px',
            right: '20px',
            background: 'none',
            border: 'none',
            color: '#fff',
            fontSize: 'clamp(1.75rem, 4vw, 3rem)',
            cursor: 'pointer',
            lineHeight: 1,
            opacity: 0.7,
            padding: 'clamp(4px, 0.6vw, 10px) clamp(8px, 1.2vw, 20px)',
          }}
        >
          ×
        </button>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            gap: 'clamp(7px, 1.5vw, 12px)',
            width: '70vw',
            height: '70vh',
            cursor: 'default',
          }}
        >
          {event.rules.map((rule, i) => (
            <div
              key={i}
              style={{
                background: RULE_COLORS[i % RULE_COLORS.length],
                borderRadius: 'clamp(4px, 1.2cqmin, 12px)',
                padding: 'clamp(8px, 3.5cqmin, 32px) clamp(10px, 4.5cqmin, 40px)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: 'clamp(8px, 3.5cqmin, 28px)',
                minWidth: 0,
                minHeight: 0,
                containerType: 'size',
              }}
            >
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 'clamp(0.85rem, 7.5cqmin, 3rem)',
                  lineHeight: 1.3,
                  textAlign: 'left',
                  overflowWrap: 'break-word',
                }}
              >
                {rule.text}
              </div>
              <div
                style={{
                  flexShrink: 0,
                  fontSize: 'clamp(0.5rem, 2.4cqmin, 1rem)',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  padding: 'clamp(2px, 0.8cqmin, 8px) clamp(4px, 1.8cqmin, 14px)',
                  border: '1px solid rgba(255,255,255,0.4)',
                  borderRadius: 'clamp(2px, 0.6cqmin, 6px)',
                  opacity: 0.8,
                  whiteSpace: 'nowrap',
                }}
              >
                {rule.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
