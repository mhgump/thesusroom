import type { DataBackend } from '../dataBackend.js'

// One JSON document per player recording, keyed by the PlayerRegistry index.
// On the filesystem backend these land at
// `content/player_recordings/{index}.json`; on other backends the key is
// opaque.
export interface RecordingEvent<M = unknown> {
  // Milliseconds since recording start. Drives wall-clock replay pacing.
  tOffsetMs: number
  // Authoritative server tick at send time. Preserved for debugging; replay
  // does not currently use it.
  serverTick: number
  // The exact ServerMessage value we sent to the player's WebSocket.
  message: M
}

export interface PlayerRecordingDoc<M = unknown> {
  schemaVersion: 1
  browserUuid: string
  playerIndex: number
  // The first room's routing key (e.g. `r_demo` or `hub`). Informational.
  routingKey: string
  // The crypto.randomUUID() assigned on first connect. Informational.
  inGamePlayerId: string
  startedAtUnixMs: number
  durationMs: number
  finalized: true
  events: RecordingEvent<M>[]
}

export class PlayerRecordings {
  constructor(private readonly data: DataBackend) {}

  private key(playerIndex: number): string {
    return `player_recordings/${playerIndex}`
  }

  saveRecording<M>(playerIndex: number, doc: PlayerRecordingDoc<M>): Promise<void> {
    return this.data.writeJson(this.key(playerIndex), doc)
  }

  loadRecording<M>(playerIndex: number): Promise<PlayerRecordingDoc<M> | null> {
    return this.data.readJson<PlayerRecordingDoc<M>>(this.key(playerIndex))
  }

  async hasRecording(playerIndex: number): Promise<boolean> {
    const doc = await this.data.readJson(this.key(playerIndex))
    return doc !== null
  }
}
