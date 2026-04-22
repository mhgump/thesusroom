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

  if (!event) return null

  return (
    <>
      <style>{`
        .rule-close-btn:hover { opacity: 1 !important; }
      `}</style>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          zIndex: 200,
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          fontFamily: 'system-ui, monospace',
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
            fontSize: '1.75rem',
            cursor: 'pointer',
            lineHeight: 1,
            opacity: 0.7,
            padding: '4px 8px',
          }}
        >
          ×
        </button>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            width: 'min(640px, 90vw)',
          }}
        >
          {event.rules.map((rule, i) => (
            <div
              key={i}
              style={{
                background: RULE_COLORS[i % RULE_COLORS.length],
                borderRadius: '6px',
                padding: '14px 32px 18px',
                color: '#fff',
              }}
            >
              <div
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  opacity: 0.7,
                  textAlign: 'center',
                  marginBottom: '8px',
                }}
              >
                {rule.label}
              </div>
              <div
                style={{
                  fontSize: '1rem',
                  lineHeight: 1.4,
                  textAlign: 'center',
                }}
              >
                {rule.text}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
