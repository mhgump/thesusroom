import WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import type { ConnectionContext, ConnectionHandler } from './types.js'
import type { ServerMessage } from '../types.js'
import { parseReplayParams } from './urls.js'

// Pure-playback handler for `/recordings/{index}`. The recording is
// self-sufficient — its `world_reset` event carries the full map bundle —
// so replay needs no world, no scenario, no player seat. Just load the doc,
// schedule each event at its `tOffsetMs` delay, send `replay_ended` shortly
// after the last event.
export class ReplayHandler implements ConnectionHandler {
  async handle(ws: WebSocket, request: IncomingMessage, ctx: ConnectionContext): Promise<void> {
    const params = parseReplayParams(request.url)
    if (!params) {
      ws.close(4004, 'Invalid replay URL')
      return
    }

    let doc
    try {
      doc = await ctx.playerRecordings.loadRecording<ServerMessage>(params.index)
    } catch (err) {
      console.error(`[ReplayHandler] loadRecording(${params.index}) failed:`, err)
      ws.close(4004, 'Recording load error')
      return
    }
    if (!doc) {
      ws.close(4004, 'Recording not found')
      return
    }

    const timers: ReturnType<typeof setTimeout>[] = []
    let cancelled = false
    ws.on('close', () => {
      cancelled = true
      for (const t of timers) clearTimeout(t)
      timers.length = 0
    })

    const schedule = (delayMs: number, fn: () => void): void => {
      const t = setTimeout(() => {
        if (cancelled) return
        fn()
      }, Math.max(0, delayMs))
      timers.push(t)
    }

    for (const evt of doc.events) {
      schedule(evt.tOffsetMs, () => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(evt.message))
      })
    }

    // Send replay_ended a small buffer after the last event so the last
    // frame of game state is visible before the overlay takes over.
    // setTimeouts at the same delay fire in insertion order, but the
    // rendering pipeline needs a frame or two to paint what arrived just
    // before the overlay flips.
    const lastOffset = doc.events.length > 0 ? doc.events[doc.events.length - 1].tOffsetMs : 0
    const REPLAY_END_BUFFER_MS = 250
    schedule(lastOffset + REPLAY_END_BUFFER_MS, () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'replay_ended' } satisfies ServerMessage))
    })
  }
}
