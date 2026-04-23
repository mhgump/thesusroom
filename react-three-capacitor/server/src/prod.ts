import http from 'http'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { GameServer } from './GameServer.js'
import { initPhysics } from './World.js'

const PORT = parseInt(process.env.PORT ?? '8080', 10)
await initPhysics()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Running via tsx: __dirname = .../react-three-capacitor/server/src
// Built frontend lands at  .../react-three-capacitor/dist
const staticDir = path.join(__dirname, '..', '..', 'dist')

const app = express()
app.use(express.static(staticDir))
// SPA fallback: serve index.html for all paths so React handles /scenario1, /demo, etc.
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'))
})

const server = http.createServer(app)
new GameServer(server)

server.listen(PORT, () => {
  console.log(`[server] :${PORT}`)
})
