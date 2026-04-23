import type { World } from './World.js'

// Module-level ref to the client's local World instance.
// Set by Player.tsx on init; read by useWebSocket to apply geometry updates immediately.
export const localWorld: { current: World | null } = { current: null }
