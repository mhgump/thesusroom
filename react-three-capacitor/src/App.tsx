import { useState, useCallback, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { GameScene } from './scene/GameScene';
import { HUD } from './hud/HUD';
import { PlayerHudOverlay } from './hud/PlayerHudOverlay';
import { useWebSocket } from './network/useWebSocket';
import { useGameStore } from './store/gameStore';

export default function App() {
  const [sceneReady, setSceneReady] = useState(false);
  const setObserverMode = useGameStore((s) => s.setObserverMode);

  useEffect(() => {
    if (/^\/observe\/[^/]+\/\d+\/\d+$/.test(window.location.pathname)) {
      setObserverMode(true);
    }
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
      <Canvas
        orthographic
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        style={{ width: '100%', height: '100%' }}
        onCreated={handleCreated}
      >
        <GameScene />
      </Canvas>

      {sceneReady && <HUD />}
      <PlayerHudOverlay />

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
          style={{
            width: '35vh',
            height: '35vh',
            borderRadius: '50%',
            animation: 'pulse 2s ease-in-out infinite',
          }}
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
