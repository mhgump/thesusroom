import { useGameStore } from '../store/gameStore'
import { useWsSend } from '../network/useWebSocket'

const CHOICE_COLORS = [
  '#E8534A',
  '#F0A540',
  '#5DBB63',
  '#4A90D9',
  '#9B59B6',
  '#2EC4B6',
  '#E91E8C',
  '#8B6F47',
]

export function ChoicePopup() {
  const event = useGameStore((s) => s.activeChoiceEvent)
  const dismissChoice = useGameStore((s) => s.dismissChoice)
  const { sendChoiceAction } = useWsSend()

  if (!event) return null

  const handleSelect = (optionId: string) => {
    sendChoiceAction(event.eventId, optionId)
    dismissChoice()
  }

  const count = event.options.length

  return (
    <>
      <style>{`
        .choice-card { transition: filter 0.1s; }
        .choice-card:hover { filter: brightness(1.15); }
        .choice-card:active { filter: brightness(0.85); }
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
          padding: 'clamp(12px, 3vw, 24px)',
          fontFamily: 'system-ui, monospace',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${count}, 1fr)`,
            gap: 'clamp(8px, 2vw, 16px)',
            width: '90vw',
            maxWidth: `min(${count * 200}px, 90vw)`,
          }}
        >
          {event.options.map((option, i) => (
            <button
              key={option.id}
              className="choice-card"
              onClick={() => handleSelect(option.id)}
              style={{
                background: CHOICE_COLORS[i % CHOICE_COLORS.length],
                border: 'none',
                borderRadius: '8px',
                aspectRatio: '1.2 / 1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                cursor: 'pointer',
                padding: 'clamp(8px, 1.5vw, 14px)',
                color: '#fff',
                textAlign: 'center',
              }}
            >
              {option.upperDetail && (
                <span style={{ fontSize: 'clamp(0.65rem, 1.8vw, 0.85rem)', opacity: 0.85 }}>{option.upperDetail}</span>
              )}
              <span style={{ fontSize: 'clamp(0.9rem, 2.8vw, 1.2rem)', fontWeight: 700 }}>{option.title}</span>
              {option.lowerDetail && (
                <span style={{ fontSize: 'clamp(0.65rem, 1.8vw, 0.85rem)', opacity: 0.85 }}>{option.lowerDetail}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
