import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'

const RULE_COLORS = [
  '#1A4A8A',
  '#1D6A40',
  '#7B1A2A',
  '#0D5959',
  '#4A1A6A',
]

export function RulesPanel() {
  const rulesOpen = useGameStore((s) => s.rulesOpen)
  const setRulesOpen = useGameStore((s) => s.setRulesOpen)
  const activeRules = useGameStore((s) => s.activeRules)

  useEffect(() => {
    if (!rulesOpen) return
    const handler = () => setRulesOpen(false)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [rulesOpen, setRulesOpen])

  if (!rulesOpen) return null

  return (
    <>
      <style>{`
        .rules-close-btn:hover { opacity: 1 !important; }
        .rules-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.2) transparent; }
        .rules-scroll::-webkit-scrollbar { width: 4px; }
        .rules-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }
      `}</style>
      <div
        onClick={() => setRulesOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.82)',
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
          className="rules-close-btn"
          onClick={() => setRulesOpen(false)}
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
          className="rules-scroll"
          style={{
            width: 'min(760px, 92vw)',
            maxHeight: '75vh',
            overflowY: 'auto',
            cursor: 'default',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'clamp(8px, 2vw, 14px)',
            }}
          >
            {activeRules.map((text, i) => (
              <div
                key={i}
                style={{
                  background: RULE_COLORS[i % RULE_COLORS.length],
                  borderRadius: '6px',
                  padding: 'clamp(10px, 2vw, 16px) clamp(12px, 2.5vw, 20px)',
                  color: '#fff',
                  fontSize: 'clamp(0.8rem, 2.2vw, 1rem)',
                  lineHeight: 1.4,
                }}
              >
                {text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
