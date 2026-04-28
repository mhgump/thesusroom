import type { DataBackend } from '../dataBackend.js'

const KEY = 'player_uuids'

// Strictly-incrementing integer index -> browser UUID. Used to give every
// human player a stable, shareable `/recordings/{index}` URL regardless of
// what in-game playerId they had on any given connection. Append-only.
export class PlayerRegistry {
  constructor(private readonly data: DataBackend) {}

  // Assigns (and returns) the integer index for this browser UUID. If the
  // UUID is already registered, returns the existing index without
  // appending. Callers serialize concurrent calls to avoid read-then-write
  // races on the underlying list.
  async registerPlayer(browserUuid: string): Promise<number> {
    const existing = await this.data.listIndexOf(KEY, browserUuid)
    if (existing !== -1) return existing
    return this.data.appendToList(KEY, browserUuid)
  }

  indexOfPlayer(browserUuid: string): Promise<number> {
    return this.data.listIndexOf(KEY, browserUuid)
  }

  async uuidAtIndex(index: number): Promise<string | null> {
    const list = await this.data.readList<string>(KEY)
    return list[index] ?? null
  }

  listPlayers(): Promise<string[]> {
    return this.data.readList<string>(KEY)
  }
}
