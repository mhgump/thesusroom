import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import type { ConnectionHandler, ConnectionContext } from './types.js'
import type { RoomOrchestration, RoutingResolver } from '../orchestration/RoomOrchestration.js'
import { parseObserverParams, parseReplayParams, parseRoutingKey } from './urls.js'

// Maps an incoming WebSocket to the `ConnectionHandler` that should own its
// lifecycle. The dispatcher performs URL-shape matching only — actual URL
// parsing for handler-specific fields happens inside the handler, so the
// dispatcher doesn't need to know about observer `{i}/{j}` or replay indices.
//
// Routing-key-based handlers (r_*, sr_*, hub) are resolved through the
// supplied `RoutingResolver`; the resolver result is cached per key so
// concurrent cold-start requests share a single backend load.
export class ConnectionDispatcher {
  private readonly orchestrationByKey: Map<string, Promise<RoomOrchestration | null>> = new Map()

  constructor(
    private readonly resolver: RoutingResolver,
    private readonly observeHandler: ConnectionHandler,
    private readonly replayHandler: ConnectionHandler,
    private readonly buildCtx: (handler: ConnectionHandler) => ConnectionContext,
  ) {}

  async dispatch(ws: WebSocket, request: IncomingMessage): Promise<void> {
    const handler = await this.resolveHandler(request)
    if (!handler) {
      ws.close(4004, 'Unknown route')
      return
    }
    try {
      await handler.handle(ws, request, this.buildCtx(handler))
    } catch (err) {
      console.error('[ConnectionDispatcher] handler threw:', err)
      try { ws.close(4004, 'Handler failure') } catch { /* ignore */ }
    }
  }

  // Shared with `DefaultGameOrchestration` via the ConnectionContext so the
  // hub flow can resolve its target scenario's orchestration without
  // re-implementing the cache.
  async resolveRoomOrchestration(routingKey: string): Promise<RoomOrchestration | null> {
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

  private async resolveHandler(request: IncomingMessage): Promise<ConnectionHandler | null> {
    if (parseReplayParams(request.url)) return this.replayHandler
    if (parseObserverParams(request.url)) return this.observeHandler
    const key = parseRoutingKey(request.url)
    if (!key) return null
    return this.resolveRoomOrchestration(key)
  }
}
