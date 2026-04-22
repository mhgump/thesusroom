# Server–Client Protocol — Assumptions

- `World.ts` at `src/game/World.ts` (client) and `server/src/World.ts` (server) are kept byte-for-byte identical; a diff between them is a bug.
- The remote position and event delay constant is exactly 250 ms.
- Input history is bounded at exactly 180 frames; a `move_ack` for a sequence older than `currentSeq − 180` may not be fully replayable.
- Sequence numbers reset on reconnect: a reconnecting client receives a new `playerId`, triggering fresh sequence initialisation on both sides.
- Position snapshots are keyed by server `endTime`, not by client receipt time; interpolation operates in server-time space.
- `positionBuffer.ts` is a plain module with no React dependency; remote position and event buffer state must not be stored in Zustand (doing so would trigger a React re-render on every frame per remote player).
