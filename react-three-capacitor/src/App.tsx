import { useCallback, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { GameScene } from './scene/GameScene';
import { HUD } from './hud/HUD';
import { useWebSocket } from './network/useWebSocket';
import { useGameStore } from './store/gameStore';
import { ensureClientWorld } from './game/clientWorld';

export default function App() {
  const sceneReady = useGameStore((s) => s.sceneReady);
  const setSceneReady = useGameStore((s) => s.setSceneReady);
  const setObserverMode = useGameStore((s) => s.setObserverMode);
  const [worldReady, setWorldReady] = useState(false);

  useEffect(() => {
    const p = window.location.pathname;
    if (
      /^\/observe\/[^/]+\/\d+\/\d+$/.test(p) ||
      /^\/recordings\/\d+$/.test(p)
    ) {
      setObserverMode(true);
    }
    ensureClientWorld().then(() => setWorldReady(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useWebSocket();

  const handleCreated = useCallback(() => {
    requestAnimationFrame(() => setSceneReady(true));
  }, []);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#000',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {worldReady && (
        <Canvas
          orthographic
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          style={{ width: '100%', height: '100%' }}
          onCreated={handleCreated}
        >
          <GameScene />
        </Canvas>
      )}

      {sceneReady && <HUD />}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          opacity: sceneReady ? 0 : 1,
          pointerEvents: sceneReady ? 'none' : 'all',
          transition: 'opacity 0.5s ease',
        }}
      >
        <img
          src="/backroomslogo.png"
          alt="The Sus Rooms"
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            width: '35vh',
            height: '35vh',
            borderRadius: '50%',
            animation: 'pulse 2s ease-in-out infinite',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitUserDrag: 'none',
            WebkitTouchCallout: 'none',
            pointerEvents: 'none',
          } as React.CSSProperties}
        />
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.75; transform: scale(0.96); }
          }
        `}</style>
      </div>
    </div>
  );
}
