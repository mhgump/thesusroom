import { useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { GameScene } from './scene/GameScene';
import { HUD } from './hud/HUD';
import { PlayerHudOverlay } from './hud/PlayerHudOverlay';
import { useWebSocket } from './network/useWebSocket';

export default function App() {
  const [sceneReady, setSceneReady] = useState(false);

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
