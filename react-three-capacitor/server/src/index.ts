import http from 'http'
import express from 'express'
import { GameServer } from './GameServer.js'
import { ContentRegistry } from './ContentRegistry.js'
import { initPhysics } from './World.js'
import { attachNumberDisplay, NUMBER_DISPLAY_ROUTES } from './NumberDisplay.js'

const PORT = parseInt(process.env.PORT ?? '8080', 10)
await initPhysics()

// Mirror prod's HTTP+WS shape so dev-only routes (e.g. NumberDisplay) are
// reachable in dev too. Vite proxies these paths through from :5173.
const app = express()
const server = http.createServer(app)
new GameServer(new ContentRegistry(), server, PORT)
attachNumberDisplay(server, app, NUMBER_DISPLAY_ROUTES)
server.listen(PORT, () => { console.log(`[server] :${PORT}`) })
