import { GameServer } from './GameServer.js';

const PORT = parseInt(process.env.PORT ?? '8080', 10);
new GameServer(PORT);
