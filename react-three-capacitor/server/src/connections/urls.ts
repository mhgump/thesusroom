import type { IncomingMessage } from 'http'

// Each helper returns the parsed shape for its URL form, or `null` if the URL
// doesn't match. Handlers use them to extract the fields they need; the
// dispatcher uses the null-vs-non-null result to pick which handler to run.

// A `/observe/{key}/{i}/{j}` path. `{key}` is the routing key, which may be
// either a bare `hub` or a two-segment form like `scenarios/{id}` or
// `scenariorun/{id}`.
export function parseObserverParams(url: string | undefined): { routingKey: string; i: number; j: number } | null {
  if (!url) return null
  const path = url.split('?')[0]
  const match = path.match(/^\/observe\/(hub|scenarios\/[^/]+|scenariorun\/[^/]+)\/(\d+)\/(\d+)$/)
  if (!match) return null
  return { routingKey: match[1], i: parseInt(match[2], 10), j: parseInt(match[3], 10) }
}

// The non-observer URL path is either `/` (→ `hub`), `/scenarios/{id}` (→
// `scenarios/{id}`), or `/scenariorun/{id}` (→ `scenariorun/{id}`). The
// returned routing key doubles as the path suffix bots connect under, so it
// is preserved verbatim rather than flattened into a single segment.
export function parseRoutingKey(url: string | undefined): string | null {
  if (!url) return 'hub'
  const path = url.split('?')[0]
  const stripped = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (stripped.length === 0 || stripped === 'hub') return 'hub'
  const m = stripped.match(/^(scenarios|scenariorun)\/([^/]+)$/)
  if (m) return `${m[1]}/${m[2]}`
  return null
}

// `/recordings/{index}` — WebSocket endpoint for replay. The saved recording
// is self-sufficient: its `world_reset` event carries the full map bundle,
// so the client no longer needs the routing key in the URL to pick a
// scenario-specific chunk.
export function parseReplayParams(url: string | undefined): { index: number } | null {
  if (!url) return null
  const path = url.split('?')[0]
  const m = path.match(/^\/recordings\/(\d+)$/)
  return m ? { index: parseInt(m[1], 10) } : null
}

// Reads the browser-scoped UUID that identifies which recording (if any)
// this connection belongs to. Prefers the `sr_uid` cookie set by the
// Express/Vite middleware; falls back to a `?uid=<uuid>` query param for
// cross-origin dev setups where the cookie is dropped on the WS upgrade.
// Returns null for connections that never loaded the SPA (bots, raw ws
// clients, test harnesses) — those are never recorded.
export function parseSrUid(req: IncomingMessage): string | null {
  const raw = req.headers.cookie
  if (raw) {
    const m = raw.match(/(?:^|;\s*)sr_uid=([0-9a-f-]{36})/)
    if (m) return m[1]
  }
  if (req.url) {
    const q = req.url.split('?')[1]
    if (q) {
      const params = new URLSearchParams(q)
      const uid = params.get('uid')
      if (uid && /^[0-9a-f-]{36}$/.test(uid)) return uid
    }
  }
  return null
}
