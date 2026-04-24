import type { ButtonConfig, ButtonState } from './GameSpec.js'
import type { BotSpec } from './bot/BotTypes.js'

export interface ActivateVoteRegionEvent {
  type: 'activate_vote_region'
  regionId: string
}

export interface ActiveVoteRegionChangeEvent {
  type: 'active_vote_region_change'
  activeIds: string[]
}

// All capabilities available to a game script. Every registration (after, on*)
// takes a handler id (a key into `GameScript.handlers`) plus a serializable
// payload — never a closure. This keeps the script's "what will fire next"
// purely as data so `Scenario.dumpState()` can round-trip.
export interface GameScriptContext {
  // Send an instruction (looked up by spec id) to a specific player.
  sendInstruction(playerId: string, specId: string): void
  // Send multiple instructions as a single event to a specific player.
  sendInstructions(playerId: string, specIds: string[]): void
  // Enable or disable a vote region for position-tracking purposes.
  toggleVoteRegion(regionId: string, active: boolean): void
  // Register a named handler to fire on vote-region assignment changes for any
  // of `regionIds`. Returns a listener id usable with `off()`.
  onVoteChanged(regionIds: string[], handlerId: string): string
  // Schedule a one-shot named handler to fire after `durationMs` of sim time.
  // `payload` must be JSON-serializable; it is passed to the handler on fire.
  // Returns a timer id usable with `cancelAfter()`.
  after(durationMs: number, handlerId: string, payload?: unknown): string
  // Cancel a pending timer. No-op if already fired or unknown.
  cancelAfter(timerId: string): void
  // Remove any listener (vote / room-enter / button-press / button-release) by
  // the id returned from its registration. No-op if unknown.
  off(listenerId: string): void
  // Returns ids of all currently connected human players.
  getPlayerIds(): string[]
  // Returns the current world-space position of a player, or null if not found.
  getPlayerPosition(playerId: string): { x: number; z: number } | null
  // Remove a player from the game immediately (equivalent to elimination).
  eliminatePlayer(playerId: string): void
  // Remove this scenario from the open registry so no new players can join.
  // Connected players continue until they all disconnect, then the room is destroyed.
  closeScenario(): void
  // Signal that this scenario has reached its terminal success condition.
  // The enclosing room forwards this to any registered listener (e.g. the
  // run-scenario CLI). Does not end the scenario on its own — pair with
  // `closeScenario()` if needed.
  terminate(): void
  // Show or hide geometry objects for the specified players (all players if playerIds is omitted).
  setGeometryVisible(geometryIds: string[], visible: boolean, playerIds?: string[]): void
  // Returns the current player → vote-region-id mapping for all tracked players.
  getVoteAssignments(): Map<string, string | null>
  // Register a named handler to fire when a button transitions to pressed.
  // Handler receives the list of occupant player ids as its payload.
  // Returns a listener id usable with `off()`.
  onButtonPress(buttonId: string, handlerId: string): string
  // Register a named handler to fire when a pressed button is released
  // (occupants drop below threshold). Handler receives an empty payload.
  // Returns a listener id usable with `off()`.
  onButtonRelease(buttonId: string, handlerId: string): string
  // Patch mutable button config at runtime (e.g. change requiredPlayers, cooldownMs).
  // Broadcasts a button_config message to all clients and re-evaluates press criteria immediately.
  modifyButton(buttonId: string, changes: Partial<ButtonConfig>): void
  // Directly set a button's state. Broadcasts to clients but does not re-evaluate press criteria.
  setButtonState(buttonId: string, state: ButtonState): void
  // Send a transient notification toast to the specified players (all players if omitted).
  sendNotification(text: string, playerIds?: string[]): void
  // Apply damage to a player. Eliminates the player if HP reaches 0.
  applyDamage(playerId: string, amount: number): void
  // Register a named handler to fire whenever a player transitions into a new
  // room. Handler receives `{ playerId, roomId }` as payload. Returns a
  // listener id usable with `off()`.
  onPlayerEnterRoom(handlerId: string): string
  // Spawn a bot that connects to this scenario as a player, driven by the given spec.
  spawnBot(spec: BotSpec): void
  // Enable or disable a physical adjacency link between two rooms. Symmetric.
  // Controls only the "stay in rooms" topology constraint, not rendering or
  // geometry — scenarios typically pair a connection toggle with a matching
  // geometry toggle (door open/close), but the two concerns stay orthogonal.
  setConnectionEnabled(scopedRoomIdA: string, scopedRoomIdB: string, enabled: boolean): void
  // Set (or clear, with null) the per-player override of which rooms a player
  // is allowed to be in. When set, replaces the connection-derived default.
  setPlayerAllowedRooms(playerId: string, scopedRoomIds: string[] | null): void
  // Show or hide an entire room for the specified players (all players if playerIds is omitted).
  setRoomVisible(roomIds: string[], visible: boolean, playerIds?: string[]): void
  // Add a persistent cosmetic rule for a player. Rules accumulate and are shown in the rules panel.
  addRule(playerId: string, text: string): void
  // Hand this scenario's entire active player population off into a fresh
  // initial-hallway MR (the "exit transfer"). The scenario's spec must carry
  // `exitConnection`; the server builds the target MR, attaches this
  // scenario's map below the hallway, and re-seats every player at their
  // translated world position. Fires at most once; subsequent calls are no-ops.
  exitScenario(): void
  // Remove a previously-attached map instance from the enclosing room. The
  // room broadcasts `map_remove` to every seated player so each client drops
  // the corresponding geometry. Intended for scenarios that need to tear
  // down an auxiliary map (e.g. the exit-hallway script removing the source
  // map once everyone has entered the hallway).
  removeMap(mapInstanceId: string): void
  // Grant a usable ability to a single player. The client renders a button
  // for each currently-granted ability in a fixed HUD slot (bottom-right,
  // max 2 per player). Pressing the button sends `ability_use` back to the
  // server, which is dispatched to any handler registered via
  // `onAbilityUse(abilityId, handlerId)`. Granting an ability that is
  // already granted is a no-op (the existing spec stays in place).
  grantAbility(
    playerId: string,
    abilityId: string,
    spec: { label: string; color?: string },
  ): void
  // Remove an ability from a player. Client drops the corresponding HUD
  // button. No-op if the ability wasn't granted.
  revokeAbility(playerId: string, abilityId: string): void
  // Register a named handler to fire whenever any player uses the given
  // ability. Handler receives `{ playerId, abilityId }` as payload. Returns
  // a listener id usable with `off()`. Multiple handlers for the same
  // ability fire in registration order.
  onAbilityUse(abilityId: string, handlerId: string): string
  // End-of-scenario bot walk-off. Every bot currently attached to this
  // scenario has its collisions disabled, begins walking straight east
  // (ignoring its BotSpec's phase logic), and is removed from the room
  // shortly afterwards. Returns immediately; removal is asynchronous. Safe
  // to call before `exitScenario()` if the caller also schedules a delay so
  // the walk-off is visible before the scenario tears down.
  exitBots(): void
}

// Signature for every named handler and for top-level `onPlayerConnect` /
// `onPlayerReady`. The `this: void` guard forbids `this.foo = x` inside the
// body — all mutable state must be written through `state`.
export type GameScriptHandler<S, P = unknown> = (
  this: void,
  state: S,
  ctx: GameScriptContext,
  payload: P,
) => void

// A game script is a stateless behavior definition. `initialState()` produces
// the per-scenario state object (the one surface the Scenario dumps to JSON).
// `handlers` is the catalog of named functions that `ctx.after` and `ctx.on*`
// dispatch to; the lookup key is the handler id passed at registration.
//
// At most one game script runs per scenario; state is owned by the Scenario,
// not the script. Scripts must therefore not hold instance fields, module-
// scope mutable bindings, or closures over per-scenario data — anything
// mutable has to live on `state`.
export interface GameScript<S = unknown> {
  // Produce a fresh state object for a new scenario instance.
  initialState(): S
  // Called whenever a new human player connects to the room.
  onPlayerConnect?: GameScriptHandler<S, string>
  // Called when a connected player signals client-side readiness.
  onPlayerReady?: GameScriptHandler<S, string>
  // Called once the first time a player crosses from outside the scenario's
  // attached rooms into one of them. Scenarios whose hubConnection drops
  // players into a hub hallway and transfers them via walk-in should use
  // this for initial instruction events so the player isn't spammed while
  // still in the hallway.
  onPlayerEnterScenario?: GameScriptHandler<S, string>
  // Catalog of named handlers. Keys are handler ids; values receive the
  // scenario state, the ctx, and whatever payload was passed at registration
  // time (`undefined` for `onButtonRelease`, etc.).
  handlers?: Record<string, GameScriptHandler<S, any>>
}

// ── Payloads passed to framework-dispatched handlers ─────────────────────────

export interface VoteChangedPayload {
  assignments: Record<string, string | null>
}

export interface PlayerEnterRoomPayload {
  playerId: string
  roomId: string
}

export interface ButtonPressPayload {
  occupants: string[]
}

export interface AbilityUsePayload {
  playerId: string
  abilityId: string
}
