import http from 'http'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { GameServer } from './GameServer.js'
import { ContentRegistry } from './ContentRegistry.js'
import { initPhysics } from './World.js'
import { attachNumberDisplay, buildDefaultNumberDisplayRoutes } from './NumberDisplay.js'
import { attachSrUidCookie, attachValidationRoutes } from './httpRoutes.js'
import { attachScenarioRunRoutes } from './scenarioRun/scenarioRunRoutes.js'

const PORT = parseInt(process.env.PORT ?? '8080', 10)
await initPhysics()

const app = express()
const server = http.createServer(app)
const gameServer = new GameServer(new ContentRegistry(), server, PORT)

// Mirror prod's HTTP+WS shape so dev-only routes (e.g. NumberDisplay) are
// reachable in dev too. Vite proxies these paths through from :5173.
attachNumberDisplay(server, app, buildDefaultNumberDisplayRoutes())
attachScenarioRunRoutes(app, gameServer)

// When a built dist exists, also serve the SPA on this port. The scenario-run
// harness uses this to point Playwright at `http://localhost:8080/observe/...`
// instead of standing up its own HTTP server. Human dev traffic still goes
// through Vite on :5173 regardless.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const staticDir = path.join(__dirname, '..', '..', 'dist')
const hasBuiltSpa = fs.existsSync(path.join(staticDir, 'index.html'))
if (hasBuiltSpa) {
  attachSrUidCookie(app)
  app.use(express.static(staticDir))
}

const sendSpaOrOk = (res: express.Response): void => {
  if (hasBuiltSpa) res.sendFile(path.join(staticDir, 'index.html'))
  // Fallback: Vite HEAD-probes these routes and only reads the status.
  else res.status(200).end()
}

if (hasBuiltSpa) app.get('/', (_req, res) => sendSpaOrOk(res))

// Validation routes for dev: Vite's middleware HEAD-probes these to decide
// whether to 404 a nav request or let its own SPA handler serve index.html.
// With a built dist present we serve the SPA directly so Playwright can load
// `/observe/:key/:i/:j` without Vite in the loop.
attachValidationRoutes(app, gameServer, sendSpaOrOk)

server.listen(PORT, () => { console.log(`[server] :${PORT}`) })
