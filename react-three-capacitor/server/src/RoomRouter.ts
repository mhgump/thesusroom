import type WebSocket from 'ws'
import type { MultiplayerRoom } from './Room.js'
import type { RoomOrchestration, RoutingResolver } from './orchestration/RoomOrchestration.js'
import type { MultiplayerRoomRegistry } from './MultiplayerRoomRegistry.js'

// Thin facade that resolves routing keys to orchestrations and delegates
// room-state operations to the MultiplayerRoomRegistry.
//
// This shim will be dissolved in Step 6 of the ConnectionHandler refactor: the
// dispatcher will own the orchestration resolution cache and every caller
// will hit the registry directly. Kept as a drop-in replacement for now so
// the earlier steps land without touching GameServer or httpRoutes.
export class RoomRouter {
  // Promise-keyed so concurrent cold-start requests for the same key share a
  // single backend load rather than racing to construct duplicate orchestrations.
  private readonly orchestrationByKey: Map<string, Promise<RoomOrchestration | null>> = new Map()

  constructor(
    private readonly resolver: RoutingResolver,
    private readonly registry: MultiplayerRoomRegistry,
  ) {}

  async routePlayer(routingKey: string, ws: WebSocket, browserUuid: string | null = null): Promise<{ room: MultiplayerRoom; playerId: string } | null> {
    const orch = await this.resolveOrchestration(routingKey)
    if (!orch) return null
    const room = this.registry.getOrCreateOpenRoom(routingKey, orch)
    const playerId = room.connectPlayer(ws, browserUuid, routingKey)
    return { room, playerId }
  }

  getRoomByIndex(routingKey: string, i: number): MultiplayerRoom | null {
    return this.registry.getRoomByIndex(routingKey, i)
  }

  hasRoomAndPlayer(routingKey: string, i: number, j: number): boolean {
    return this.registry.hasRoomAndPlayer(routingKey, i, j)
  }

  async canRouteKey(routingKey: string): Promise<boolean> {
    return (await this.resolveOrchestration(routingKey)) !== null
  }

  async findOrCreateHubSlot(routingKey: string): Promise<MultiplayerRoom | null> {
    const orch = await this.resolveOrchestration(routingKey)
    if (!orch) return null
    return this.registry.findOrCreateHubSlot(routingKey, orch)
  }

  private async resolveOrchestration(routingKey: string): Promise<RoomOrchestration | null> {
    const cached = this.orchestrationByKey.get(routingKey)
    if (cached) return cached
    const p = this.resolver(routingKey)
    this.orchestrationByKey.set(routingKey, p)
    p.then(
      v => { if (v === null) this.orchestrationByKey.delete(routingKey) },
      () => { this.orchestrationByKey.delete(routingKey) },
    )
    return p
  }
}
