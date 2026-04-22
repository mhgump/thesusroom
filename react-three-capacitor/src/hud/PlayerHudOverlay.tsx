import { useCallback } from 'react'
import { useGameStore } from '../store/gameStore'
import { hudRegistry } from '../scene/hudRegistry'
import { HpIndicator } from './HpIndicator'

const DIV_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  display: 'none',
  pointerEvents: 'none',
  willChange: 'transform',
}

function LocalPlayerHeart() {
  const hp = useGameStore((s) => (s.playerId ? (s.playerHp[s.playerId] ?? 2) : 2)) as 0 | 1 | 2
  const ref = useCallback((el: HTMLDivElement | null) => {
    hudRegistry.set('__local__', el)
  }, [])
  return (
    <div ref={ref} style={DIV_STYLE}>
      <HpIndicator hp={hp} />
    </div>
  )
}

function RemotePlayerHeart({ id }: { id: string }) {
  const hp = useGameStore((s) => (s.playerHp[id] ?? 2)) as 0 | 1 | 2
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (el) hudRegistry.set(id, el)
    else hudRegistry.delete(id)
  }, [id])
  return (
    <div ref={ref} style={DIV_STYLE}>
      <HpIndicator hp={hp} />
    </div>
  )
}

export function PlayerHudOverlay() {
  const remotePlayers = useGameStore((s) => s.remotePlayers)
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      <LocalPlayerHeart />
      {Object.values(remotePlayers)
        .filter((p) => p.hasHealth)
        .map((p) => (
          <RemotePlayerHeart key={p.id} id={p.id} />
        ))}
    </div>
  )
}
