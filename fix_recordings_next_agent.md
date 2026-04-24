# Finish the Player Recording + Replay Feature

## What this feature is

Every human player's first session is captured for up to 60 seconds as a stream of `ServerMessage` events and persisted to `content/player_recordings/{index}.json` via the `DataBackend` facade. Each browser has a stable UUID (cookie + localStorage fallback for cross-origin dev), and `content/player_uuids.json` maps strictly-incrementing integers → browser UUIDs. The route `/recordings/{index}` replays that player's captured experience by streaming the saved wire messages back through a WebSocket at wall-clock pace. Intent: anyone can open `/recordings/0` in a browser and watch the first minute of player #0's session exactly as it happened, including every `welcome` / `move_ack` / `player_update` / `instruction` etc., with no live game state needed.

## What's already built (working)

**Server**
- `react-three-capacitor/server/src/PlayerRecordingManager.ts` — singleton that captures outgoing messages per browser UUID, times them as `{ tOffsetMs, serverTick, message }`, and writes a `PlayerRecordingDoc` to the backend on disconnect or at the 60s mark. Serializes concurrent registrations via a promise chain. Idempotent: once a browser has an in-flight OR persisted recording, no new one ever starts for it.
- `react-three-capacitor/server/src/Room.ts` — two hook sites: `sendToPlayer` (one line) and `broadcast` (per-player loop). `connectPlayer(ws, browserUuid, routingKey)` takes the routing key from the router so recordings store the URL-facing key (e.g. `r_scenario2`, `hub`), not the internal `roomId` (which is the scenario id). `removePlayer` calls `recordingManager.onPlayerDisconnected(playerId)` so partial sessions save immediately.
- `react-three-capacitor/server/src/GameServer.ts` — builds `PlayerRecordingManager` in the constructor, threads it through `RoomRouter`. `parseSrUid` prefers the `sr_uid` cookie but falls back to `?uid=<uuid>` query param (for cross-origin dev). `parseReplayParams` matches `/recordings/:key/:idx`. `handleReplayConnection` loads the doc and schedules every event via `setTimeout(fn, evt.tOffsetMs)`, ending with a `replay_ended` ServerMessage.
- `react-three-capacitor/server/src/httpRoutes.ts` — shared route attacher. `attachSrUidCookie` + `attachValidationRoutes`. Short form `/recordings/:idx` issues a 302 to `/recordings/:key/:idx` (key pulled from the saved doc). Canonical form `/recordings/:key/:idx` validates and 404s if missing. Similar guards for `/observe/:key/:i/:j` and `/:routingKey` (where key must start `r_`). Used by both `src/prod.ts` (serves SPA) and `src/index.ts` (dev backend, responds 200/404 only — Vite serves SPA).
- `tools/src/_shared/backends/ops/playerRegistry.ts` — `PlayerRegistry` over `DataBackend`, idempotent `registerPlayer(uuid)` → integer index.
- `tools/src/_shared/backends/ops/playerRecordings.ts` — `PlayerRecordings` over `DataBackend`. Keys are `player_recordings/{index}`. `PlayerRecordingDoc` schema: `{ schemaVersion, browserUuid, playerIndex, routingKey, inGamePlayerId, startedAtUnixMs, durationMs, finalized, events: [{ tOffsetMs, serverTick, message }] }`.
- `react-three-capacitor/server/src/types.ts` and client `src/network/types.ts` both have `| { type: 'replay_ended' }` in the `ServerMessage` union.

**Client**
- `react-three-capacitor/src/App.tsx` — sets `observerMode = true` for `/observe/...` and `/recordings/:key/:idx`.
- `react-three-capacitor/src/network/useWebSocket.ts` — `getWsPath` passes observer/replay paths through verbatim. `getWsUrl` reads the `sr_uid` cookie from `document.cookie` and appends `?uid=<uuid>` so the cross-origin dev WS (VITE_WS_URL pointing at `:8080`) still carries the browser id. `case 'replay_ended'` sets `observerEndReason = 'replay_ended'`.
- `react-three-capacitor/src/hud/EliminationOverlay.tsx` — shows `RECORDING ENDED` when `observerEndReason === 'replay_ended'`.
- `react-three-capacitor/src/store/gameStore.ts` — `observerEndReason: 'none' | 'eliminated' | 'disconnected' | 'replay_ended'`.
- `content/maps/index.ts` — `parseScenarioIdFromPath` recognizes `/recordings/:key/:idx` and keys off the routing key to pick the statically-imported map (**this is the load-bearing workaround you are here to remove**).

**Dev plumbing**
- `react-three-capacitor/vite.config.ts` — `srUidCookiePlugin` sets `sr_uid` on every HTML GET (non-HttpOnly so the SPA can read it). `validate404Plugin` HEAD-pings the backend for `/observe/*`, `/recordings/*`, `/recordings/*/*`, `/r_*` and returns 404 / propagates 302s (so the short-form `/recordings/:idx` redirect works in dev).

**Verified end-to-end on disk**
- `content/player_uuids.json` is populated with browser UUIDs as players connect.
- `content/player_recordings/0.json` gets saved on disconnect with all captured events (typical: ~600 events over ~10s, including `welcome`, `world_reset`, `move_ack`, `player_joined`, `player_update`, etc.).
- `/recordings/0` in the browser redirects to `/recordings/r_scenario2/0` and renders the correct scenario map.

## The two problems left to solve

### Problem 1 — Event replay is not visible
User loads `/recordings/0`, redirected to `/recordings/r_scenario2/0`, the map renders (from the static import), but **no events visibly play back**: no player avatars appear, no camera movement, no rules/instructions. The recording file definitely contains the expected events (verified by `jq`), and the server's `handleReplayConnection` schedules them via `setTimeout`. Needs diagnosis:

Likely suspects, in rough priority order:
- **Ordering race during reconnect**: `WebSocketClient.connect()` creates `new WebSocket(url)` and sets `onmessage` synchronously, but `useWebSocket`'s `addHandler` runs next in the same tick. If any replay message fires before `addHandler` registers, the handler set is empty and the message is dropped. Worth tracing.
- **`replay_ended` arriving too early**: I schedule `replay_ended` at `lastEvent.tOffsetMs` (same delay as the final event). Multiple `setTimeout` at the same delay fire in registration order, so events should land first — but there's no buffer. If the overlay flips before the last events have rendered, the user sees a mostly-empty scene under the overlay. Add a small gap (e.g. +250ms) and verify.
- **`world_reset` + static map interaction**: `content/maps/index.ts` statically loads scenario2's map. Then `world_reset` fires (at `tOffsetMs=1`) and the client's handler wipes every map and re-adds them from the wire. If `reifyGameMap` produces a map that doesn't render correctly, or if `applyConnectionsSnapshot` leaves the world inconsistent, the scene could freeze. Inspect the `world_reset` handler's effect on the rendered world during replay specifically.
- **Observer-mode camera**: `move_ack` messages update the local (observed) player's position via `pushMoveAck`. Verify the camera actually follows that target in observer mode — it works for `/observe/...` today, so the same path should work for replay, but it's worth confirming by adding a `console.log` around camera target selection while on `/recordings/...`.

Recommended debugging path: open browser devtools on `/recordings/0`, watch the WS frames tab to confirm messages actually arrive, and put a `console.log` at the top of `useWebSocket.ts`'s `client.addHandler` callback to confirm the handler sees every event in order.

### Problem 2 — Make the recording file fully self-sufficient
The user's explicit intent: **"the intent is to only load the recording file and have all the information we need duplicated there (i.e. the actual server events sent to the client to help it load the world)."** The current implementation has a workaround — the URL carries the routing key so the client can statically import a scenario-specific map. That's a dependency on the scenario spec at replay time, which violates the intent.

The in-progress dynamic map refactor (new `world_reset` / `map_add` / `map_remove` wire messages that ship the full `SerializedMap` + geometry + connections) is the mechanism to remove the workaround. **Do not start this task until that refactor has landed.** Signs it has landed:
- `ServerMessage` union in `react-three-capacitor/server/src/types.ts` and `react-three-capacitor/src/network/types.ts` is stable (no `map_init`, yes `world_reset`/`map_add`/`map_remove`).
- `src/game/GameMap.ts` exports a working `reifyGameMap(serialized)` and the accompanying serializer.
- The player flow (`/r_scenario2`, `/`) works end-to-end — the server sends `world_reset` on connect, the client rebuilds its world from that message alone, and visiting the page with an empty `CURRENT_MAP` works.
- `Room.handleWorldResetAck` exists (currently missing — `tsc --noEmit` complains about it).
- The typecheck for `react-three-capacitor/server` passes cleanly (right now it errors on `GameServer.ts(195, handleWorldResetAck)`, `types.ts(5, GameMap.js)`, `content/maps/index.ts(42, import.meta.glob)`).

Once the refactor has landed, do the following:

1. **Drop the routing key from the replay URL.** Revert `/recordings/:key/:idx` back to the short form `/recordings/:idx`:
   - `react-three-capacitor/server/src/GameServer.ts` — change `parseReplayParams` back to `^\/recordings\/(\d+)$`.
   - `react-three-capacitor/server/src/httpRoutes.ts` — delete the 302 redirect; `/recordings/:idx` serves the SPA (or 404s) directly.
   - `react-three-capacitor/src/App.tsx` — observer-mode regex back to `/^\/recordings\/\d+$/`.
   - `react-three-capacitor/src/network/useWebSocket.ts` — `getWsPath` regex back to `^recordings\/\d+$`.
   - `react-three-capacitor/vite.config.ts` — remove the `/^\/recordings\/[^/]+\/\d+$/` entry from `VALIDATION_PATH_REGEXES` and drop the 302-propagation branch (only needed for the short-form redirect).
   - `content/maps/index.ts` — drop the `recordings/([^/]+)/\d+` branch in `parseScenarioIdFromPath`. The `/recordings/:idx` path should resolve to `null` (no statically-imported map).

2. **Make the client render an empty world until `world_reset` arrives for replay pages.** The replay first event is `welcome` at `tOffsetMs=0`, then `world_reset` at `tOffsetMs=1`. The client's `world_reset` handler wipes maps and rebuilds from the wire. So as long as the scene can tolerate a few ms with no map (or a blank placeholder), the static import is unnecessary. Confirm the rendering stack handles an empty world on `/recordings/:idx`, then remove the static-map dependency for that path.

3. **Keep `routingKey` inside the saved doc anyway.** It's useful for analytics / filtering (`jq '.routingKey'`) even if the URL doesn't carry it. No storage change needed — the doc already has it.

4. **Spot-check that the hub case replays correctly.** The hub orchestration stitches `INITIAL_MAP` + a target scenario's map into one room. A recording made on `/` (routingKey = `hub`) will have a `world_reset` with **both** maps serialized. Once the dynamic-map client is done, replaying `/recordings/0` for a hub session should show both the hallway and scenario2 stitched together with no static imports — this is the test case that proves the self-sufficiency requirement.

5. **Re-verify the smoke test** end-to-end: play on `/r_scenario2` for ~10s, disconnect, watch the server log `[PlayerRecordingManager] SAVED recording #0 — N events over Xms (...)`, then open `/recordings/0` and confirm the replay plays and ends with the `RECORDING ENDED` overlay at the expected duration.

## Design decisions already confirmed with the user (don't re-litigate)

- Early disconnect: save the partial recording immediately on disconnect (already done via `onPlayerDisconnected`).
- Multi-tab / reconnect for the same browser: record only the first-ever connection; subsequent connects from the same UUID are ignored (already enforced in `PlayerRecordingManager.onPlayerConnected`).
- Bots (no cookie): skip recording (already enforced by the `browserUuid && this.recordingManager` guard in `Room.connectPlayer`).
- Replay end signaling: a new `replay_ended` ServerMessage type + overlay that says `RECORDING ENDED` (already wired through client).

## Files you'll touch

- `react-three-capacitor/server/src/GameServer.ts`
- `react-three-capacitor/server/src/httpRoutes.ts`
- `react-three-capacitor/src/App.tsx`
- `react-three-capacitor/src/network/useWebSocket.ts`
- `react-three-capacitor/vite.config.ts`
- `content/maps/index.ts`
- (For problem 1 diagnosis) likely also `react-three-capacitor/src/network/WebSocketClient.ts` and `react-three-capacitor/src/network/positionBuffer.ts`

## Files you should read first

- `react-three-capacitor/server/src/PlayerRecordingManager.ts` — understand the in-memory lifecycle, the registerChain serialization, and the idempotency guards.
- `react-three-capacitor/server/src/GameServer.ts:handleReplayConnection` — the current replay server implementation.
- `react-three-capacitor/src/network/useWebSocket.ts` — especially the `world_reset`, `map_add`, `map_remove` handlers added by the in-progress refactor; understanding those is a prerequisite to removing the static map dependency.
- `content/maps/index.ts` — the scenario-id-from-URL parser that we'll simplify.
- `content/player_recordings/0.json` (inspect with `jq`) — a real artifact to validate your mental model of the event stream.
