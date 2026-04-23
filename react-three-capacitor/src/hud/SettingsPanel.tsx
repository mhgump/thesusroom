import { useState, useEffect, CSSProperties } from 'react'
import { getSoundEnabled, setSoundEnabled } from '../settings'

interface Props {
  onClose: () => void
}

const btnStyle: CSSProperties = {
  pointerEvents: 'auto',
  background: 'rgba(255,255,255,0.12)',
  border: '1px solid rgba(255,255,255,0.25)',
  borderRadius: 4,
  color: '#fff',
  fontSize: 'clamp(10px, 1.5vw, 14px)',
  fontWeight: 700,
  letterSpacing: '0.08em',
  padding: 'clamp(7px, 1.2vw, 11px) clamp(16px, 3vw, 28px)',
  cursor: 'pointer',
  fontFamily: 'system-ui, monospace',
  width: '100%',
}

export function SettingsPanel({ onClose }: Props) {
  const [view, setView] = useState<'main' | 'settings'>('main')
  const [soundEnabled, setSoundEnabledState] = useState(getSoundEnabled)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function toggleSound(checked: boolean) {
    setSoundEnabledState(checked)
    setSoundEnabled(checked)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        pointerEvents: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'rgba(10,10,20,0.97)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8,
          padding: 'clamp(24px, 4vw, 48px) clamp(28px, 5vw, 56px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'clamp(8px, 1.2vw, 14px)',
          minWidth: 'clamp(160px, 25vw, 280px)',
        }}
      >
        {view === 'main' ? (
          <>
            <button style={btnStyle} onClick={() => setView('settings')}>SETTINGS</button>
            <button style={btnStyle} onClick={() => { window.location.href = '/' }}>RESPAWN</button>
          </>
        ) : (
          <>
            <label
              style={{
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: 'clamp(7px, 1vw, 12px)',
                cursor: 'pointer',
                fontSize: 'clamp(10px, 1.5vw, 14px)',
                fontFamily: 'system-ui, monospace',
                letterSpacing: '0.05em',
                width: '100%',
              }}
            >
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={e => toggleSound(e.target.checked)}
                style={{ width: 'clamp(13px, 1.5vw, 18px)', height: 'clamp(13px, 1.5vw, 18px)', cursor: 'pointer' }}
              />
              SOUND
            </label>
            <button
              style={{ ...btnStyle, marginTop: 'clamp(5px, 0.8vw, 10px)', background: 'transparent', fontSize: 'clamp(8px, 1.2vw, 12px)' }}
              onClick={() => setView('main')}
            >
              ← BACK
            </button>
          </>
        )}
      </div>
    </div>
  )
}
