import type { ServerMessage } from './types.js'
import type {
  PlayerRegistry,
  PlayerRecordings,
  PlayerRecordingDoc,
  RecordingEvent,
} from '../../../tools/src/_shared/backends/index.js'

export const RECORDING_DURATION_MS = 60_000

interface RecordingState {
  browserUuid: string
  // -1 until resolveIndex finishes assigning it. Messages still capture
  // during this window so the welcome is never missed; save defers until
  // an index exists.
  playerIndex: number
  inGamePlayerId: string
  routingKey: string
  startedAtMs: number
  events: RecordingEvent<ServerMessage>[]
  timer: ReturnType<typeof setTimeout>
  finalized: boolean
  indexReady: Promise<void>
}

// Captures every outgoing ServerMessage destined for a human player for the
// first RECORDING_DURATION_MS of that player's first-ever session and
// persists it as a replayable document via the DataBackend facade.
//
// Keyed semantics: one recording per browser (cookie-backed UUID). Once a
// recording has started or been saved for a given browser UUID, subsequent
// connections from the same browser are silently ignored — they still play
// the game normally, but their messages are not captured. Bots and any
// other connections without a browser cookie are likewise never recorded.
//
// Hook site: `MultiplayerRoom.sendToPlayer` and `broadcast` call
// `onMessageToPlayer(inGamePlayerId, msg, serverTick)` for every wire
// message. The manager resolves `inGamePlayerId -> browserUuid` via the
// map populated synchronously in `onPlayerConnected` so the welcome
// message (fired synchronously right after connectPlayer) is captured.
export class PlayerRecordingManager {
  private readonly byPlayerId = new Map<string, string>()
  private readonly byBrowser = new Map<string, RecordingState>()
  // Serialize DataBackend list round-trips (listIndexOf then appendToList)
  // so two concurrent upgrades with distinct-but-simultaneous UUIDs cannot
  // both read an empty list and both append index 0.
  private registerChain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly registry: PlayerRegistry,
    private readonly store: PlayerRecordings,
    private readonly durationMs: number = RECORDING_DURATION_MS,
  ) {}

  // Call from the room when a human player connects. Runs synchronously so
  // the welcome message fired immediately after connectPlayer is captured.
  // The async half (playerIndex assignment and persisted-recording dedupe)
  // runs in the background; if it determines this browser already has a
  // saved recording, the in-progress buffer is dropped.
  onPlayerConnected(params: {
    browserUuid: string
    inGamePlayerId: string
    routingKey: string
  }): void {
    const { browserUuid, inGamePlayerId, routingKey } = params

    // Same browser already has an in-flight recording. The hub-transfer
    // flow releases the player from a solo MR and immediately reseats
    // them on the target MR under a new in-game id — rebind the
    // playerId-keyed lookup so subsequent messages keep appending to the
    // same buffer rather than starting a second (aborted) recording.
    const existing = this.byBrowser.get(browserUuid)
    if (existing) {
      if (existing.inGamePlayerId !== inGamePlayerId) {
        this.byPlayerId.delete(existing.inGamePlayerId)
        existing.inGamePlayerId = inGamePlayerId
        this.byPlayerId.set(inGamePlayerId, browserUuid)
      }
      return
    }

    const state: RecordingState = {
      browserUuid,
      playerIndex: -1,
      inGamePlayerId,
      routingKey,
      startedAtMs: Date.now(),
      events: [],
      finalized: false,
      timer: setTimeout(() => {
        void this.finalize(browserUuid)
      }, this.durationMs),
      indexReady: Promise.resolve(),
    }
    this.byBrowser.set(browserUuid, state)
    this.byPlayerId.set(inGamePlayerId, browserUuid)

    state.indexReady = this.resolveIndex(state).catch((err) => {
      console.error('[PlayerRecordingManager] resolveIndex failed:', err)
      this.abortPending(state)
    })
  }

  private async resolveIndex(state: RecordingState): Promise<void> {
    const next = this.registerChain.then(() =>
      this.registry.registerPlayer(state.browserUuid),
    )
    this.registerChain = next.catch(() => {})

    const playerIndex = await next
    if (state.finalized) return
    state.playerIndex = playerIndex

    if (await this.store.hasRecording(playerIndex)) {
      // A persisted recording already exists for this browser. Discard the
      // in-flight buffer so we don't overwrite it on finalize.
      this.abortPending(state)
    }
  }

  private abortPending(state: RecordingState): void {
    if (this.byBrowser.get(state.browserUuid) !== state) return
    state.finalized = true
    clearTimeout(state.timer)
    this.byBrowser.delete(state.browserUuid)
    this.byPlayerId.delete(state.inGamePlayerId)
  }

  onMessageToPlayer(inGamePlayerId: string, msg: ServerMessage, serverTick: number): void {
    const browserUuid = this.byPlayerId.get(inGamePlayerId)
    if (!browserUuid) return
    const s = this.byBrowser.get(browserUuid)
    if (!s || s.finalized) return
    s.events.push({
      tOffsetMs: Date.now() - s.startedAtMs,
      serverTick,
      message: msg,
    })
  }

  // Call from the room when a human player's WebSocket closes. Finalizes
  // the in-flight recording immediately (with whatever's buffered, up to
  // durationMs), rather than leaving it to the background timer. No-op if
  // this inGamePlayerId isn't being recorded (bot, observer, or second
  // tab of a browser that's already recording).
  onPlayerDisconnected(inGamePlayerId: string): void {
    const browserUuid = this.byPlayerId.get(inGamePlayerId)
    if (!browserUuid) return
    void this.finalize(browserUuid)
  }

  // Forcibly finalize every in-flight recording. Intended for clean
  // shutdown so partial minutes reach disk.
  async finalizeAll(): Promise<void> {
    const browsers = [...this.byBrowser.keys()]
    await Promise.all(browsers.map((b) => this.finalize(b)))
  }

  private async finalize(browserUuid: string): Promise<void> {
    const s = this.byBrowser.get(browserUuid)
    if (!s || s.finalized) return
    s.finalized = true
    clearTimeout(s.timer)

    // Index may not be assigned yet if registry registration was slow.
    // Wait for it; if it ultimately fails, skip the save.
    try {
      await s.indexReady
    } catch {
      this.byBrowser.delete(browserUuid)
      this.byPlayerId.delete(s.inGamePlayerId)
      return
    }
    if (s.playerIndex < 0) {
      this.byBrowser.delete(browserUuid)
      this.byPlayerId.delete(s.inGamePlayerId)
      return
    }

    const doc: PlayerRecordingDoc<ServerMessage> = {
      schemaVersion: 1,
      browserUuid: s.browserUuid,
      playerIndex: s.playerIndex,
      routingKey: s.routingKey,
      inGamePlayerId: s.inGamePlayerId,
      startedAtUnixMs: s.startedAtMs,
      durationMs: Math.min(this.durationMs, Date.now() - s.startedAtMs),
      finalized: true,
      events: s.events,
    }
    try {
      await this.store.saveRecording(s.playerIndex, doc)
      console.log(
        `[PlayerRecordingManager] SAVED recording #${s.playerIndex} — ${s.events.length} events over ${doc.durationMs}ms (browser=${s.browserUuid.slice(0, 8)}…, routingKey=${s.routingKey})`,
      )
    } catch (err) {
      console.error('[PlayerRecordingManager] saveRecording failed:', err)
    } finally {
      this.byBrowser.delete(browserUuid)
      this.byPlayerId.delete(s.inGamePlayerId)
    }
  }
}
