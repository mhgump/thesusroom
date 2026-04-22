export interface ToggleVoteRegionOnEvent {
  type: 'toggle_vote_region_on'
  regionId: string
}

export interface ToggleVoteRegionOffEvent {
  type: 'toggle_vote_region_off'
  regionId: string
}

export interface InstructionEvent {
  type: 'instruction'
  targetPlayerId: string
  specId: string
}

export type GameScriptEvent = ToggleVoteRegionOnEvent | ToggleVoteRegionOffEvent | InstructionEvent

// All capabilities available to a game script.
export interface GameScriptContext {
  // Send an instruction (looked up by spec id) to a specific player.
  sendInstruction(playerId: string, specId: string): void
  // Enable or disable a vote region for position-tracking purposes.
  toggleVoteRegion(regionId: string, active: boolean): void
  // Register a callback that fires whenever the player→vote-region assignment
  // changes for any of the specified region ids.
  // assignments: every tracked player mapped to their current region id or null.
  onVoteChanged(regionIds: string[], callback: (assignments: Map<string, string | null>) => void): void
  // Schedule a one-shot callback after durationMs milliseconds.
  // Returns a cancel function that prevents the callback if called before it fires.
  after(durationMs: number, callback: () => void): () => void
  // Returns ids of all currently connected human players.
  getPlayerIds(): string[]
  // Returns the current world-space position of a player, or null if not found.
  getPlayerPosition(playerId: string): { x: number; z: number } | null
  // Remove a player from the game immediately (equivalent to elimination).
  eliminatePlayer(playerId: string): void
}

// Interface that a game script must implement.
// At most one game script runs per world at a time.
export interface GameScript {
  // Called whenever a new human player connects to the room.
  onPlayerConnect(ctx: GameScriptContext, playerId: string): void
}
