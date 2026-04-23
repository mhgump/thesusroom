import { BotClient } from './BotClient.js'
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

  stopAll(): void {
    for (const client of this.clients) client.stop()
    this.clients.clear()
  }
}
