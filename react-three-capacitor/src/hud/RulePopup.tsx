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
          padding: 'clamp(12px, 3vw, 24px)',
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
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(7px, 1.5vw, 12px)',
            width: 'min(640px, 90vw)',
            cursor: 'default',
          }}
        >
          {event.rules.map((rule, i) => (
            <div
              key={i}
              style={{
                background: RULE_COLORS[i % RULE_COLORS.length],
                borderRadius: '6px',
                padding: 'clamp(10px, 1.5vw, 16px) clamp(12px, 2vw, 20px)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: 'clamp(10px, 2vw, 18px)',
              }}
            >
              <div
                style={{
                  flex: 1,
                  fontSize: 'clamp(0.85rem, 2.2vw, 1.05rem)',
                  lineHeight: 1.4,
                  textAlign: 'left',
                }}
              >
                {rule.text}
              </div>
              <div
                style={{
                  flexShrink: 0,
                  fontSize: 'clamp(0.55rem, 1.2vw, 0.65rem)',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  padding: 'clamp(2px, 0.4vw, 4px) clamp(5px, 1vw, 8px)',
                  border: '1px solid rgba(255,255,255,0.4)',
                  borderRadius: '3px',
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
