import http from 'http'
import express from 'express'
import { GameServer } from './GameServer.js'
import { ContentRegistry } from './ContentRegistry.js'
import { initPhysics } from './World.js'
import { attachNumberDisplay, buildDefaultNumberDisplayRoutes } from './NumberDisplay.js'
import { attachValidationRoutes } from './httpRoutes.js'

const PORT = parseInt(process.env.PORT ?? '8080', 10)
await initPhysics()

// Mirror prod's HTTP+WS shape so dev-only routes (e.g. NumberDisplay) are
// reachable in dev too. Vite proxies these paths through from :5173.
const app = express()
const server = http.createServer(app)
const gameServer = new GameServer(new ContentRegistry(), server, PORT)
attachNumberDisplay(server, app, buildDefaultNumberDisplayRoutes())

// Validation routes for dev: Vite's middleware HEAD-probes these to decide
// whether to 404 a nav request or let its own SPA handler serve index.html.
// A 200 body here is never rendered — only the status code is read.
attachValidationRoutes(app, gameServer, (res) => { res.status(200).end() })

server.listen(PORT, () => { console.log(`[server] :${PORT}`) })
