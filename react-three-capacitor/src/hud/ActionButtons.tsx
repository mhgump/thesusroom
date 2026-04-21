import { useGameStore } from '../store/gameStore';
import { useWsSend } from '../network/useWebSocket';

const ACTION_PALETTE: Record<string, string> = {
  SKIP: 'rgba(0, 200, 200, 0.65)',
};

const DEFAULT_COLOR = 'rgba(255, 255, 255, 0.2)';

export function ActionButtons() {
  const availableActions = useGameStore((s) => s.availableActions);
  const { sendAction } = useWsSend();

  if (availableActions.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        alignItems: 'flex-end',
      }}
    >
      {availableActions.slice(0, 3).map((action) => (
        <button
          key={action}
          onPointerDown={(e) => {
            e.preventDefault();
            sendAction(action);
          }}
          style={{
            width: 76,
            height: 76,
            borderRadius: 14,
            border: '2px solid rgba(255,255,255,0.45)',
            background: ACTION_PALETTE[action] ?? DEFAULT_COLOR,
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: 'system-ui, monospace',
            letterSpacing: '0.05em',
            cursor: 'pointer',
            touchAction: 'none',
            userSelect: 'none',
            backdropFilter: 'blur(4px)',
          }}
        >
          {action}
        </button>
      ))}
    </div>
  );
}
