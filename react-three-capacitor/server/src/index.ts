import { GameServer } from './GameServer.js'
import { initPhysics } from './World.js'

const PORT = parseInt(process.env.PORT ?? '8080', 10)
await initPhysics()
new GameServer(PORT)
