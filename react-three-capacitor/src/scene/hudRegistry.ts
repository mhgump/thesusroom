// Maps player IDs to their heart overlay divs.
// '__local__' is the key for the local player.
// Written by PlayerHudOverlay (React, outside Canvas) via callback refs.
// Read by PlayerHudUpdater (R3F, inside Canvas) in useFrame priority -1.
export const hudRegistry = new Map<string, HTMLDivElement | null>()
