import { useEffect, useState } from 'react'
import { World, initPhysics } from './World.js'
import { localWorld } from './localWorld.js'
import { CURRENT_MAP } from '../../../content/maps'

// The singleton client World. Populated from wire messages post-Part B; for
// now we seed it from the statically-imported CURRENT_MAP so the renderer has
// a map to draw before any server message arrives.
let worldPromise: Promise<World> | null = null
let worldInstance: World | null = null

async function createClientWorld(): Promise<World> {
  await initPhysics()
  const w = new World(['touched'])
  w.addMap(CURRENT_MAP)
  worldInstance = w
  localWorld.current = w
  return w
}

export function ensureClientWorld(): Promise<World> {
  if (!worldPromise) worldPromise = createClientWorld()
  return worldPromise
}

export function getClientWorld(): World | null { return worldInstance }

// React hook: returns the singleton World once it's initialized, re-rendering
// the caller whenever maps are added or removed.
export function useClientWorld(): World | null {
  const [world, setWorld] = useState<World | null>(worldInstance)
  const [, setVersion] = useState(0)

  useEffect(() => {
    let unsub: (() => void) | null = null
    let cancelled = false
    ensureClientWorld().then(w => {
      if (cancelled) return
      setWorld(w)
      unsub = w.subscribeToMapChanges(() => setVersion(v => v + 1))
    })
    return () => { cancelled = true; unsub?.() }
  }, [])

  return world
}
