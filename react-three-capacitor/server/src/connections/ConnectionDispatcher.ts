import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import type { ConnectionHandler, ConnectionContext } from './types.js'
import type { RoomOrchestration, RoutingResolver } from '../orchestration/RoomOrchestration.js'
import { isRoomOrchestration } from '../orchestration/RoomOrchestration.js'
import { parseObserverParams, parseReplayParams, parseRoutingKey } from './urls.js'

// Maps an incoming WebSocket to the `ConnectionHandler` that should own its
// lifecycle. The dispatcher performs URL-shape matching only — actual URL
// parsing for handler-specific fields happens inside the handler, so the
// dispatcher doesn't need to know about observer `{i}/{j}` or replay indices.
//
// Routing-key-based handlers (scenarios/*, scenariorun/*, hub) are resolved
// through the supplied `RoutingResolver`; the resolver result is cached per
// key so concurrent cold-start requests share a single backend load.
export class ConnectionDispatcher {
  private readonly handlerByKey: Map<string, Promise<ConnectionHandler | null>> = new Map()

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
  // re-implementing the cache. Narrows the cached handler to its room-
  // creating subtype via `isRoomOrchestration`; returns null if the key
  // resolves to a handler that doesn't own rooms (e.g. another hub).
  async resolveRoomOrchestration(routingKey: string): Promise<RoomOrchestration | null> {
    const handler = await this.resolveForKey(routingKey)
    if (!handler) return null
    return isRoomOrchestration(handler) ? handler : null
  }

  // Used by httpRoutes.ts to validate that a routing key maps to some
  // handler before serving the SPA shell for it.
  async canRouteKey(routingKey: string): Promise<boolean> {
    return (await this.resolveForKey(routingKey)) !== null
  }

  private async resolveHandler(request: IncomingMessage): Promise<ConnectionHandler | null> {
    if (parseReplayParams(request.url)) return this.replayHandler
    if (parseObserverParams(request.url)) return this.observeHandler
    const key = parseRoutingKey(request.url)
    if (!key) return null
    return this.resolveForKey(key)
  }

  private async resolveForKey(routingKey: string): Promise<ConnectionHandler | null> {
    const cached = this.handlerByKey.get(routingKey)
    if (cached) return cached
    const p = this.resolver(routingKey)
    this.handlerByKey.set(routingKey, p)
    p.then(
      v => { if (v === null) this.handlerByKey.delete(routingKey) },
      () => { this.handlerByKey.delete(routingKey) },
    )
    return p
  }
}
