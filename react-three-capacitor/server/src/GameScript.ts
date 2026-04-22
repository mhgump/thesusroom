import type { ButtonConfig, ButtonState } from './GameSpec.js'

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
  // Remove this scenario from the open registry so no new players can join.
  // Connected players continue until they all disconnect, then the room is destroyed.
  closeScenario(): void
  // Show or hide geometry objects for the specified players (all players if playerIds is omitted).
  setGeometryVisible(geometryIds: string[], visible: boolean, playerIds?: string[]): void
  // Returns the current player → vote-region-id mapping for all tracked players.
  getVoteAssignments(): Map<string, string | null>
  // Register a callback that fires when a button transitions to pressed.
  // Returns a cancel function to deregister the listener.
  onButtonPress(buttonId: string, callback: (occupants: string[]) => void): () => void
  // Register a callback that fires when a pressed button is released (occupants drop below threshold).
  // Returns a cancel function to deregister the listener.
  onButtonRelease(buttonId: string, callback: () => void): () => void
  // Patch mutable button config at runtime (e.g. change requiredPlayers, cooldownMs).
  // Broadcasts a button_config message to all clients and re-evaluates press criteria immediately.
  modifyButton(buttonId: string, changes: Partial<ButtonConfig>): void
  // Directly set a button's state. Broadcasts to clients but does not re-evaluate press criteria.
  setButtonState(buttonId: string, state: ButtonState): void
  // Send a transient notification toast to the specified players (all players if omitted).
  sendNotification(text: string, playerIds?: string[]): void
}

// Interface that a game script must implement.
// At most one game script runs per world at a time.
export interface GameScript {
  // Called whenever a new human player connects to the room.
  onPlayerConnect(ctx: GameScriptContext, playerId: string): void
}
