import { BotClient } from './BotClient.js'
import type { BotLogEntry } from './BotClient.js'
import type { BotSpec } from './BotTypes.js'

export class BotManager {
  private readonly serverUrl: string
  private readonly clients = new Set<BotClient>()

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl
  }

  spawnBot(scenarioId: string, spec: BotSpec): BotClient {
    const client = new BotClient(this.serverUrl, scenarioId, spec)
    this.clients.add(client)
    client.start()
    console.log(`[BotManager] spawned bot for scenario:${scenarioId}`)
    return client
  }

  collectLogs(): Array<{ clientIndex: number; log: BotLogEntry }> {
    const out: Array<{ clientIndex: number; log: BotLogEntry }> = []
    let i = 0
    for (const client of this.clients) {
      for (const log of client.logs) out.push({ clientIndex: i, log })
      i++
    }
    return out.sort((a, b) => a.log.time - b.log.time)
  }

  stopAll(): void {
    for (const client of this.clients) client.stop()
    this.clients.clear()
  }
}
