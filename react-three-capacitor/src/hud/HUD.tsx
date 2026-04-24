import { useGameStore } from '../store/gameStore'
import { Joystick } from './Joystick'
import { Notifications } from './Notifications'
import { EliminationOverlay } from './EliminationOverlay'
import { AbilityBar } from './AbilityBar'
import { ChoicePopup } from './ChoicePopup'
import { RulePopup } from './RulePopup'
import { RulesPanel } from './RulesPanel'
import { SettingsPanel } from './SettingsPanel'
import { useClientWorld } from '../game/clientWorld'

export function HUD() {
  const connected = useGameStore((s) => s.connected)
  const currentRoomId = useGameStore((s) => s.currentRoomId)
  const observerMode = useGameStore((s) => s.observerMode)
  const activeRules = useGameStore((s) => s.activeRules)
  const setRulesOpen = useGameStore((s) => s.setRulesOpen)
  const inputMode = useGameStore((s) => s.inputMode)
  const settingsOpen = useGameStore((s) => s.settingsOpen)
  const setSettingsOpen = useGameStore((s) => s.setSettingsOpen)
  const remotePlayers = useGameStore((s) => s.remotePlayers)
  const world = useClientWorld()

  const roomView = world?.getRoomByScopedId(currentRoomId)
  const roomName = roomView?.room.name ?? currentRoomId
  const connectedCount = Object.keys(remotePlayers).length + (observerMode ? 0 : 1)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        fontFamily: 'system-ui, monospace',
        zIndex: 10,
      }}
    >
      {/* Top-right area: status bar + rules button */}
      <div
        style={{
          position: 'absolute',
          top: 'calc(12px + env(safe-area-inset-top, 0px))',
          right: 'calc(16px + env(safe-area-inset-right, 0px))',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div
            style={{
              width: 'clamp(6px, 1vw, 10px)',
              height: 'clamp(6px, 1vw, 10px)',
              borderRadius: '50%',
              background: connected ? '#22ee88' : '#ee4444',
            }}
          />
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'clamp(10px, 1.5vw, 13px)' }}>
            {roomName} {connectedCount} connected
          </span>
        </div>

        <button
          onClick={() => setSettingsOpen(true)}
          style={{
            pointerEvents: 'auto',
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 4,
            color: '#fff',
            fontSize: 'clamp(9px, 1.5vw, 12px)',
            fontWeight: 700,
            letterSpacing: '0.08em',
            padding: 'clamp(3px, 0.5vw, 5px) clamp(8px, 1.5vw, 12px)',
            cursor: 'pointer',
            fontFamily: 'system-ui, monospace',
          }}
        >
          SETTINGS
        </button>

        {!observerMode && activeRules.length > 0 && (
          <button
            onClick={() => setRulesOpen(true)}
            style={{
              pointerEvents: 'auto',
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 4,
              color: '#fff',
              fontSize: 'clamp(9px, 1.5vw, 12px)',
              fontWeight: 700,
              letterSpacing: '0.08em',
              padding: 'clamp(3px, 0.5vw, 5px) clamp(8px, 1.5vw, 12px)',
              cursor: 'pointer',
              fontFamily: 'system-ui, monospace',
            }}
          >
            RULES
          </button>
        )}
      </div>

      <Notifications />
      <EliminationOverlay />
      {!observerMode && <ChoicePopup />}
      {!observerMode && <RulePopup />}
      {!observerMode && <RulesPanel />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {/* Ability bar — bottom-right, hidden in observer mode */}
      {!observerMode && <AbilityBar />}

      {/* Joystick — bottom-left, hidden in observer mode and tap-to-move mode */}
      {!observerMode && inputMode === 'joystick' && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
            left: 'calc(28px + env(safe-area-inset-left, 0px))',
            pointerEvents: 'auto',
          }}
        >
          <Joystick />
        </div>
      )}
    </div>
  )
}
