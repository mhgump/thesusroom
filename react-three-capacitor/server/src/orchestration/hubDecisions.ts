import type { RoomSummary } from '../MultiplayerRoomRegistry.js'

// The two decision points in the `/` hub flow, split so policy changes never
// have to touch the orchestration plumbing:
//
//   1. `ChooseExistingMultiplayerRoom` — given the snapshot of every live
//      registered room, return the (routingKey, instanceIndex) of an existing
//      room to transfer the solo-hallway player into, or null to fall through
//      to step 2.
//   2. `ChooseScenario` — return the routing key of a scenario whose
//      orchestration should stand up a fresh room. The caller does the
//      `findOrCreateHubSlot` + `acceptHubTransfer` wiring.
//
// Both choosers receive the same `HubDecisionContext`: the room snapshot and
// the pre-resolved set of hub-capable scenario routing keys. The context is
// snapshot data — mutating it has no effect on the registry.
export interface HubDecisionContext {
  // Snapshot of every live registered multiplayer room, via
  // `MultiplayerRoomRegistry.listRooms()`. Solo-hallway MRs are excluded by
  // construction (they're never registered). The snapshot is a point-in-time
  // read; choosers should re-check liveness at the callsite before acting.
  rooms: readonly RoomSummary[]
  // Routing keys of every scenario whose spec declares a `hubConnection`.
  // Resolved once at first hub connection via `resolveHubTargets` and cached
  // for the lifetime of the server.
  hubTargets: readonly string[]
}

// Deterministic pointer back to a live room in the registry. Callers pass
// (routingKey, instanceIndex) to `MultiplayerRoomRegistry.getRoomByIndex` to
// recover the `MultiplayerRoom` itself; the room may have been destroyed
// between snapshot and lookup, so null is a legal response.
export interface ExistingRoomSelection {
  routingKey: string
  instanceIndex: number
}

export type ChooseExistingMultiplayerRoom =
  (ctx: HubDecisionContext) => ExistingRoomSelection | null

export type ChooseScenario =
  (ctx: HubDecisionContext) => string | null

// --- Existing-room choosers ---

const SCENARIO2_KEY = 'scenarios/scenario2'

// Pre-refactor behaviour preserved as a standalone policy: find the first
// live, open scenario2 room whose hub slot is available. Returns null if
// there is no such room — the caller falls through to `ChooseScenario` and
// spins up a fresh one.
export const chooseFirstOpenScenario2Room: ChooseExistingMultiplayerRoom = (ctx) => {
  for (const r of ctx.rooms) {
    if (r.routingKey !== SCENARIO2_KEY) continue
    if (!r.isOpen || !r.isHubSlotOpen) continue
    return { routingKey: r.routingKey, instanceIndex: r.instanceIndex }
  }
  return null
}

// Pick the most-populated room with an open hub slot across every routing
// key — packs lobbies so arriving players join existing rooms before fresh
// ones are created. Ties are broken by the lowest instanceIndex, which is
// also the stable order `listRooms` returns them in, so selection is
// deterministic given the same snapshot. Rooms that aren't hub-capable or
// are full never win because `isHubSlotOpen` already encodes both.
export const chooseMostPopulatedOpenRoom: ChooseExistingMultiplayerRoom = (ctx) => {
  let best: RoomSummary | null = null
  for (const r of ctx.rooms) {
    if (!r.isOpen || !r.isHubSlotOpen) continue
    if (best === null) {
      best = r
      continue
    }
    if (r.playerCount > best.playerCount) {
      best = r
    } else if (r.playerCount === best.playerCount && r.instanceIndex < best.instanceIndex) {
      best = r
    }
  }
  return best ? { routingKey: best.routingKey, instanceIndex: best.instanceIndex } : null
}

// --- Scenario choosers ---

// Pre-refactor behaviour preserved: always route fresh rooms to scenario2.
// Returns null if scenario2 isn't in the hub-target list (e.g. content was
// deleted), in which case the hub flow reports the transfer failure and the
// player stays in the solo hallway.
export const chooseAlwaysScenario2: ChooseScenario = (ctx) =>
  ctx.hubTargets.includes(SCENARIO2_KEY) ? SCENARIO2_KEY : null

// Round-robin across every hub-capable scenario routing key, advancing the
// cursor by one on each call. `hubTargets` is deterministic (matches
// `ScenarioList` order), so successive connections visit scenario1 →
// scenario2 → scenario3 → scenario4 → scenario1 → … given the current
// content set. State is kept in the closure so construction matters: one
// chooser per orchestration instance, never per-call.
export function createRoundRobinScenarioChooser(): ChooseScenario {
  let cursor = 0
  return (ctx) => {
    if (ctx.hubTargets.length === 0) return null
    const key = ctx.hubTargets[cursor % ctx.hubTargets.length]
    cursor++
    return key
  }
}
