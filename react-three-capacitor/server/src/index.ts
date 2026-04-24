import { GameServer, loadContentRegistry } from './GameServer.js'
import { initPhysics } from './World.js'

const PORT = parseInt(process.env.PORT ?? '8080', 10)
await initPhysics()
const content = await loadContentRegistry()
new GameServer(content, PORT)
