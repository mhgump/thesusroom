import crypto from 'crypto'
import type express from 'express'
import type { GameServer } from './GameServer.js'

// Sets the persistent `sr_uid` cookie used by the player-recording system
// on any HTML navigation that doesn't already have one.
export function attachSrUidCookie(app: express.Express): void {
  app.use((req, res, next) => {
    if (!req.headers.cookie || !/\bsr_uid=/.test(req.headers.cookie)) {
      const uuid = crypto.randomUUID()
      const secure = req.protocol === 'https' ? '; Secure' : ''
      // Deliberately NOT HttpOnly: the SPA reads this cookie so it can
      // include the UUID as a query param when the WebSocket connects
      // cross-origin (dev setup with VITE_WS_URL pointing at a different
      // port). It's an opaque per-browser ID, not a credential.
      res.setHeader(
        'Set-Cookie',
        `sr_uid=${uuid}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`,
      )
    }
    next()
  })
}

// Attaches validation routes for URLs that map to a game entity:
//   /observe/:key/:i/:j  -> requires live room+player
//   /recordings/:index   -> requires a saved recording
//   /r_{routingKey}      -> requires a valid routing key (known scenario)
// Each route invokes `onValid(res)` when the path is legitimate, or
// responds 404 otherwise.
//
// Recordings are self-sufficient (the saved `world_reset` carries the full
// map bundle), so the replay URL carries only the index — no routing key.
//
// In dev the caller passes an `onValid` that just replies 200 OK (body
// doesn't matter — Vite's middleware only reads the status). In prod the
// caller passes one that serves the SPA index.html.
export function attachValidationRoutes(
  app: express.Express,
  gameServer: GameServer,
  onValid: (res: express.Response) => void,
): void {
  const notFound = (res: express.Response): void => {
    res.status(404).send('<html><body><p>not found</p></body></html>')
  }

  app.get('/observe/:key/:i/:j', (req, res) => {
    const i = parseInt(req.params.i, 10)
    const j = parseInt(req.params.j, 10)
    if (!gameServer.getRouter().hasRoomAndPlayer(req.params.key, i, j)) {
      notFound(res)
      return
    }
    onValid(res)
  })

  app.get('/recordings/:index', async (req, res) => {
    const idx = parseInt(req.params.index, 10)
    if (!Number.isInteger(idx) || idx < 0) {
      notFound(res)
      return
    }
    try {
      const doc = await gameServer.getRecordings().loadRecording(idx)
      if (!doc) {
        notFound(res)
        return
      }
    } catch (err) {
      console.error(`[httpRoutes] /recordings/${idx} lookup failed:`, err)
      res.status(500).send('<html><body><p>error</p></body></html>')
      return
    }
    onValid(res)
  })

  app.get('/:routingKey', async (req, res, next) => {
    const key = req.params.routingKey
    if (!key.startsWith('r_')) {
      next()
      return
    }
    try {
      if (!(await gameServer.getRouter().canRouteKey(key))) {
        notFound(res)
        return
      }
    } catch (err) {
      console.error(`[httpRoutes] canRouteKey(${key}) failed:`, err)
      res.status(500).send('<html><body><p>error</p></body></html>')
      return
    }
    onValid(res)
  })
}
