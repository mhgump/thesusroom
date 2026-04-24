import { BotClient } from './BotClient.js'
import type { BotLogEntry } from './BotClient.js'
import type { BotSpec } from './BotTypes.js'

interface TrackedClient { client: BotClient; routingKey: string }

export class BotManager {
  private readonly serverUrl: string
  private readonly tracked: TrackedClient[] = []

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl
  }

  // `routingKey` is the full path segment the bot should connect under
  // (e.g. `r_demo`). Scenario-spawned bots reuse the spawning room's key so
  // they land back in the same orchestration.
  spawnBot(routingKey: string, spec: BotSpec): BotClient {
    const client = new BotClient(this.serverUrl, routingKey, spec)
    this.tracked.push({ client, routingKey })
    client.start()
    console.log(`[BotManager] spawned bot for key:${routingKey}`)
    return client
  }

  collectLogs(): Array<{ clientIndex: number; log: BotLogEntry }> {
    const out: Array<{ clientIndex: number; log: BotLogEntry }> = []
    for (let i = 0; i < this.tracked.length; i++) {
      for (const log of this.tracked[i].client.logs) out.push({ clientIndex: i, log })
    }
    return out.sort((a, b) => a.log.time - b.log.time)
  }

  // Scenario-run callers filter by routing key so concurrent runs don't see
  // each other's bots. The `clientIndex` is reset to the key-local order so
  // downstream log-formatting lines up with the per-run bot numbering.
  collectLogsForKey(routingKey: string): Array<{ clientIndex: number; log: BotLogEntry }> {
    const out: Array<{ clientIndex: number; log: BotLogEntry }> = []
    let i = 0
    for (const t of this.tracked) {
      if (t.routingKey !== routingKey) continue
      for (const log of t.client.logs) out.push({ clientIndex: i, log })
      i++
    }
    return out.sort((a, b) => a.log.time - b.log.time)
  }

  stopForKey(routingKey: string): void {
    for (let i = this.tracked.length - 1; i >= 0; i--) {
      if (this.tracked[i].routingKey !== routingKey) continue
      this.tracked[i].client.stop()
      this.tracked.splice(i, 1)
    }
  }

  stopAll(): void {
    for (const t of this.tracked) t.client.stop()
    this.tracked.length = 0
  }
}
