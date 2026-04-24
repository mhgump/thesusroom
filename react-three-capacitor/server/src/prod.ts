import http from 'http'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { GameServer } from './GameServer.js'
import { ContentRegistry } from './ContentRegistry.js'
import { initPhysics } from './World.js'
import { attachNumberDisplay, NUMBER_DISPLAY_ROUTES } from './NumberDisplay.js'

const PORT = parseInt(process.env.PORT ?? '8080', 10)
await initPhysics()
const content = new ContentRegistry()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Running via tsx: __dirname = .../react-three-capacitor/server/src
// Built frontend lands at  .../react-three-capacitor/dist
const staticDir = path.join(__dirname, '..', '..', 'dist')

const app = express()
app.use(express.static(staticDir))

const server = http.createServer(app)
const gameServer = new GameServer(content, server, PORT)

attachNumberDisplay(server, app, NUMBER_DISPLAY_ROUTES)

// Observer not-found guard: return dummy HTML before the SPA fallback catches it.
app.get('/observe/:key/:i/:j', (req, res) => {
  const i = parseInt(req.params.i, 10)
  const j = parseInt(req.params.j, 10)
  if (!gameServer.getRouter().hasRoomAndPlayer(req.params.key, i, j)) {
    res.status(404).send('<html><body><p>not found</p></body></html>')
    return
  }
  res.sendFile(path.join(staticDir, 'index.html'))
})

// SPA fallback: serve index.html for all paths so React handles /r_demo, /r_scenario1, etc.
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'))
})

server.listen(PORT, () => {
  console.log(`[server] :${PORT}`)
})
