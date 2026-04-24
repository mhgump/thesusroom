import type http from 'http'
import type { Duplex } from 'stream'
import type { Express } from 'express'
import { WebSocketServer } from 'ws'
export { NUMBER_DISPLAY_ROUTES } from './numberDisplayRoutes.js'

// Attach routes that render a full-screen integer display. Each mapped path
// (e.g. `/tenthousand` -> 10000) serves an HTML page that opens a WebSocket
// to the same path and receives the integer once on connect.
//
// The module is fully isolated from the rest of the server: it registers its
// Express routes on the provided app, and intercepts the HTTP `upgrade` event
// only for its own paths — all other upgrades are forwarded to the listeners
// that were already registered (i.e. `GameServer`'s WebSocket). Call this
// after `new GameServer(...)` so the forward list captures its upgrade hook.
export function attachNumberDisplay(
  httpServer: http.Server,
  app: Express,
  routes: Record<string, number>,
): void {
  const paths = new Set(Object.keys(routes))

  for (const path of paths) {
    app.get(path, (_req, res) => { res.type('html').send(HTML_PAGE) })
  }

  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws, req) => {
    const value = req.url !== undefined ? routes[req.url] : undefined
    if (value === undefined) { ws.close(); return }
    ws.send(String(value))
  })

  type UpgradeListener = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void
  const existing = httpServer.listeners('upgrade').slice() as UpgradeListener[]
  httpServer.removeAllListeners('upgrade')
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== undefined && paths.has(req.url)) {
      wss.handleUpgrade(req, socket, head, ws => { wss.emit('connection', ws, req) })
      return
    }
    for (const listener of existing) listener(req, socket, head)
  })
}

const HTML_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>number</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #000; color: #fff; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, sans-serif; }
  #num { line-height: 1; font-weight: 700; white-space: nowrap; font-size: 100px; }
</style>
</head>
<body>
<div id="num"></div>
<script>
  const el = document.getElementById('num');
  const BASE = 100;
  const PAD = 0.9;
  function fit() {
    if (!el.textContent) return;
    el.style.fontSize = BASE + 'px';
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const scale = Math.min((window.innerWidth * PAD) / r.width, (window.innerHeight * PAD) / r.height);
    el.style.fontSize = (BASE * scale) + 'px';
  }
  window.addEventListener('resize', fit);
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const ws = new WebSocket(proto + location.host + location.pathname);
  ws.onmessage = (ev) => { el.textContent = ev.data; fit(); };
</script>
</body>
</html>
`
