import type http from 'http'
import type { Duplex } from 'stream'
import type { Express } from 'express'
import { WebSocketServer } from 'ws'
import {
  ScenarioList,
  VettedScenarios,
  TestSpecList,
  getDataBackend,
  type AgentConversation,
} from '../../../shared/backends/index.js'

// A route that renders a single integer full-screen. `path` supports Express
// `:param` syntax — the captured params are passed to `provider` which
// returns the integer to display. The provider is re-invoked every time a
// client connects, so the value is always fresh.
export interface NumberRoute {
  path: string
  provider: (params: Record<string, string>) => Promise<number> | number
}

// Build the default set of routes. Constructed fresh per call so backends are
// resolved lazily at attach time (env vars like DATA_BACKEND may not be set
// at import time).
export function buildDefaultNumberDisplayRoutes(): NumberRoute[] {
  return [
    { path: '/tenthousand', provider: () => 10000 },
    {
      path: '/scenariocount',
      provider: async () => {
        const data = getDataBackend()
        const list = new ScenarioList(data, new VettedScenarios(data))
        return (await list.listScenarios()).length
      },
    },
    {
      path: '/vetted',
      provider: async () => {
        const vetted = new VettedScenarios(getDataBackend())
        return (await vetted.listVettedScenarios()).length
      },
    },
    {
      path: '/tests/:scenario_index',
      provider: async ({ scenario_index }) => {
        const i = parseInt(scenario_index, 10)
        if (!Number.isInteger(i) || i < 0) return 0
        const data = getDataBackend()
        const scenarios = await new ScenarioList(data, new VettedScenarios(data)).listScenarios()
        const id = scenarios[i]
        if (id === undefined) return 0
        return (await new TestSpecList(data).listTestSpecs(id)).length
      },
    },
    {
      path: '/costs',
      provider: async () => {
        const list = await getDataBackend().readList<AgentConversation>('agent_conversations')
        return list.reduce((sum, c) => sum + c.total_cost, 0)
      },
    },
  ]
}

interface CompiledRoute extends NumberRoute {
  regex: RegExp
  keys: string[]
}

function compile(route: NumberRoute): CompiledRoute {
  const keys: string[] = []
  const pattern = route.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, k: string) => {
    keys.push(k)
    return '([^/]+)'
  })
  return { ...route, regex: new RegExp(`^${pattern}$`), keys }
}

function matchRoute(routes: CompiledRoute[], rawUrl: string): { route: CompiledRoute; params: Record<string, string> } | null {
  const path = rawUrl.split('?')[0]
  for (const route of routes) {
    const m = path.match(route.regex)
    if (!m) continue
    const params: Record<string, string> = {}
    route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]) })
    return { route, params }
  }
  return null
}

// Attach routes that render a single integer full-screen. Each route serves
// an HTML page at `path` and a WebSocket at the same URL that pushes the
// integer returned by `provider` once on connect.
//
// Fully isolated: the module intercepts the HTTP `upgrade` event only for
// URLs matching one of its routes — all other upgrades are forwarded to the
// listeners that were already registered (i.e. `GameServer`'s WebSocket).
// Call this AFTER `new GameServer(...)` so the forward list captures its
// upgrade hook.
export function attachNumberDisplay(
  httpServer: http.Server,
  app: Express,
  routes: NumberRoute[],
): void {
  const compiled = routes.map(compile)

  for (const route of routes) {
    app.get(route.path, (_req, res) => { res.type('html').send(HTML_PAGE) })
  }

  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws, req) => {
    const matched = req.url !== undefined ? matchRoute(compiled, req.url) : null
    if (!matched) { ws.close(); return }
    Promise.resolve(matched.route.provider(matched.params)).then(
      value => { if (ws.readyState === ws.OPEN) ws.send(String(value)) },
      err => {
        console.error(`[NumberDisplay] provider failed for ${req.url}:`, err)
        ws.close()
      },
    )
  })

  type UpgradeListener = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void
  const existing = httpServer.listeners('upgrade').slice() as UpgradeListener[]
  httpServer.removeAllListeners('upgrade')
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== undefined && matchRoute(compiled, req.url) !== null) {
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
