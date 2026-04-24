import http from 'http'
import express from 'express'
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
const content = new ContentRegistry()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Running via tsx: __dirname = .../react-three-capacitor/server/src
// Built frontend lands at  .../react-three-capacitor/dist
const staticDir = path.join(__dirname, '..', '..', 'dist')

const app = express()

attachSrUidCookie(app)
app.use(express.static(staticDir))

const server = http.createServer(app)
const gameServer = new GameServer(content, server, PORT)

attachNumberDisplay(server, app, buildDefaultNumberDisplayRoutes())
attachScenarioRunRoutes(app, gameServer)

const sendSpa = (res: express.Response): void => {
  res.sendFile(path.join(staticDir, 'index.html'))
}

app.get('/', (_req, res) => sendSpa(res))
app.get('/loop', (_req, res) => sendSpa(res))
attachValidationRoutes(app, gameServer, sendSpa)

// Any path that didn't match above — static assets, unknown routing keys,
// deep unknown paths — is a 404. express.static answered legitimate static
// requests earlier; anything reaching this middleware is not a real file.
app.use((_req, res) => {
  res.status(404).send('<html><body><p>not found</p></body></html>')
})

server.listen(PORT, () => {
  console.log(`[server] :${PORT}`)
})
