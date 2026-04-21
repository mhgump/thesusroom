import { useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { GameScene } from './scene/GameScene';
import { HUD } from './hud/HUD';
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

      {!sceneReady && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              border: '3px solid rgba(255,255,255,0.15)',
              borderTopColor: 'rgba(255,255,255,0.7)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
}
