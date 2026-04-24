/**
 * Run a single scenario with a given set of bots.
 *
 * Usage (from react-three-capacitor/server/):
 *   npx tsx scripts/run-scenario.ts \
 *     [--scenario <id>]               default: scenario2
 *     [--bots <path:Export> ...]      bot specs relative to project root, e.g.
 *                                     content/bots/scenario2/filler/bot.ts:SCENARIO2_BOT
 *     [--record-bot-index <n>]        bot index to observe + record video for.
 *                                     Optional; default: no recording.
 *                                     Must be < bot count when set.
 *     [--log-bot-indices <csv>]       comma-separated bot indices to collect logs
 *                                     from. Default: all bots. Use "" for none.
 *     [--output-dir <dir>]            directory for video / screenshot / response.
 *                                     Required when --record-bot-index is set.
 *     [--response-json <file>]        write structured JSON response to this file.
 *     [--timeout <ms>]                override scenario timeout.
 *
 * Requires the frontend to be built first (only if recording):
 *   cd react-three-capacitor && npm run build
 *
 * Requires playwright chromium (only if recording):
 *   npx playwright install chromium
 */

import { parseArgs } from 'node:util'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import express from 'express'
import { initPhysics } from '../src/World.js'
import { GameServer } from '../src/GameServer.js'
import { ContentRegistry } from '../src/ContentRegistry.js'
import { BotClient } from '../src/bot/BotClient.js'
import { formatLogs, type LogEntry } from './logFormat.js'
import type { BotSpec } from '../src/bot/BotTypes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

// Tee server-side console output into a structured buffer so the artifact can
// expose scenario_script_logs / scenario_script_errors to downstream tools.
interface ServerLogEntry { time: number; level: 'info' | 'warn' | 'error'; message: string }
const serverLogs: ServerLogEntry[] = []
const origLog = console.log.bind(console)
const origWarn = console.warn.bind(console)
const origErr = console.error.bind(console)
function stringify(args: unknown[]): string {
  return args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
}
console.log = (...args: unknown[]) => {
  serverLogs.push({ time: Date.now(), level: 'info', message: stringify(args) })
  origLog(...args)
}
console.warn = (...args: unknown[]) => {
  serverLogs.push({ time: Date.now(), level: 'warn', message: stringify(args) })
  origWarn(...args)
}
console.error = (...args: unknown[]) => {
  serverLogs.push({ time: Date.now(), level: 'error', message: stringify(args) })
  origErr(...args)
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    scenario:            { type: 'string',  default: 'scenario2' },
    bots:                { type: 'string',  multiple: true  },
    'record-bot-index':  { type: 'string'                   },
    'log-bot-indices':   { type: 'string'                   },
    'output-dir':        { type: 'string'                   },
    'response-json':     { type: 'string'                   },
    'run-id':            { type: 'string'                   },
    'test-spec-name':    { type: 'string'                   },
    'run-index':         { type: 'string'                   },
    timeout:             { type: 'string'                   },
    'tick-rate-hz':      { type: 'string',  default: '240'  },
    'capture-fps':       { type: 'string',  default: '60'   },
  },
  strict: true,
})

const SCENARIO_ID      = values.scenario ?? 'scenario2'
const BOT_ARGS         = values.bots ?? []
const RECORD_BOT_INDEX = values['record-bot-index'] !== undefined
  ? parseInt(values['record-bot-index'], 10)
  : null
const OUTPUT_DIR       = values['output-dir']
  ? path.resolve(process.cwd(), values['output-dir'])
  : null
const RESPONSE_JSON    = values['response-json']
  ? path.resolve(process.cwd(), values['response-json'])
  : null
const TEST_SPEC_NAME   = values['test-spec-name'] ?? '_adhoc'
const RUN_INDEX        = values['run-index'] !== undefined ? parseInt(values['run-index'], 10) : 0
const RUN_ID           = values['run-id'] ?? `${SCENARIO_ID}/${TEST_SPEC_NAME}/${RUN_INDEX}`
const TIMEOUT_OVERRIDE = values.timeout ? parseInt(values.timeout, 10) : undefined

const TICK_RATE_HZ = parseFloat(values['tick-rate-hz'] ?? '240')
if (!Number.isFinite(TICK_RATE_HZ) || TICK_RATE_HZ <= 0) {
  console.error(`--tick-rate-hz must be > 0 — got ${values['tick-rate-hz']}`)
  process.exit(1)
}
const TICK_MS = 1000 / TICK_RATE_HZ
const SPEED_MULTIPLIER = TICK_RATE_HZ / 20
const CAPTURE_FPS = parseFloat(values['capture-fps'] ?? '60')
if (!Number.isFinite(CAPTURE_FPS) || CAPTURE_FPS <= 0) {
  console.error(`--capture-fps must be > 0 — got ${values['capture-fps']}`)
  process.exit(1)
}

console.log('[run-scenario] tickRateHz=%d tickMs=%s speedMult=%d captureFps=%d', TICK_RATE_HZ, TICK_MS.toFixed(3), SPEED_MULTIPLIER, CAPTURE_FPS)

// Parse --log-bot-indices: undefined → all bots, "" → none, "0,2" → [0, 2]
const LOG_BOT_INDICES: number[] | null = values['log-bot-indices'] === undefined
  ? null  // sentinel for "all"
  : values['log-bot-indices'] === ''
    ? []
    : values['log-bot-indices'].split(',').map(s => parseInt(s.trim(), 10))

// ── Load content registry (maps + scenarios) via data backend ────────────────

const contentRegistry = new ContentRegistry()
const entry = await contentRegistry.get(SCENARIO_ID)
if (!entry) {
  console.error(`Unknown scenario: ${SCENARIO_ID}. Add it to content/scenario_map.json.`)
  process.exit(1)
}
const scenarioSpec = entry.scenario

// ── Load bot specs from CLI args ──────────────────────────────────────────────

const botSpecs: BotSpec[] = []
for (const arg of BOT_ARGS) {
  const colonIdx = arg.lastIndexOf(':')
  if (colonIdx === -1) {
    console.error(`Invalid --bots argument "${arg}": expected format "path/to/module.ts:ExportName"`)
    process.exit(1)
  }
  const modulePath = arg.slice(0, colonIdx)
  const exportName = arg.slice(colonIdx + 1)
  const absPath = path.resolve(PROJECT_ROOT, modulePath)
  const mod = await import(pathToFileURL(absPath).href) as Record<string, unknown>
  if (!(exportName in mod)) {
    console.error(`Export "${exportName}" not found in ${absPath}`)
    process.exit(1)
  }
  botSpecs.push(mod[exportName] as BotSpec)
}

// ── Validate record-bot-index against bot count ───────────────────────────────

if (RECORD_BOT_INDEX !== null) {
  if (!Number.isInteger(RECORD_BOT_INDEX) || RECORD_BOT_INDEX < 0 || RECORD_BOT_INDEX >= botSpecs.length) {
    console.error(`--record-bot-index must be an integer in [0, ${botSpecs.length}) — got ${values['record-bot-index']}`)
    process.exit(1)
  }
  if (!OUTPUT_DIR) {
    console.error('--output-dir is required when --record-bot-index is set')
    process.exit(1)
  }
}

// ── Validate log-bot-indices ──────────────────────────────────────────────────

if (LOG_BOT_INDICES !== null) {
  for (const i of LOG_BOT_INDICES) {
    if (!Number.isInteger(i) || i < 0 || i >= botSpecs.length) {
      console.error(`--log-bot-indices contains invalid index ${i}; must be in [0, ${botSpecs.length})`)
      process.exit(1)
    }
  }
}

const logBotIndexSet: Set<number> | null = LOG_BOT_INDICES === null
  ? null
  : new Set(LOG_BOT_INDICES)

// ── Validate frontend build (only if recording) ───────────────────────────────

const staticDir = path.resolve(__dirname, '../../dist')
if (RECORD_BOT_INDEX !== null && !fs.existsSync(path.join(staticDir, 'index.html'))) {
  console.error(`Frontend build not found at ${staticDir}`)
  console.error('Run: cd react-three-capacitor && npm run build')
  process.exit(1)
}

if (OUTPUT_DIR) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

// ── Register termination callback before GameServer starts ────────────────────

let terminationResolve!: () => void
const terminationPromise = new Promise<void>(resolve => { terminationResolve = resolve })
let terminatedByScenario = false
const onScenarioTerminate = (terminatedId: string) => {
  if (terminatedId !== scenarioSpec.id) return
  terminatedByScenario = true
  terminationResolve()
}

// ── Physics + Server ──────────────────────────────────────────────────────────

await initPhysics()

async function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(start, () => {
      const addr = srv.address() as net.AddressInfo
      srv.close(() => resolve(addr.port))
    })
    srv.on('error', () => findFreePort(start + 1).then(resolve, reject))
  })
}

const PORT = await findFreePort(8090)

const app = express()
if (RECORD_BOT_INDEX !== null) app.use(express.static(staticDir))

const httpServer = http.createServer(app)
// When recording, leave the scenario in its "created but not started" state
// until the observer browser is recording. Bots can connect and auto-ready
// freely during that window; the Scenario buffers their connect/ready events
// and replays them in order when `startScenario(id)` is called. Non-recording
// runs start the scenario immediately.
const AUTO_START = RECORD_BOT_INDEX === null
const gameServer = new GameServer(contentRegistry, httpServer, PORT, {
  tickRateHz: TICK_RATE_HZ,
  autoStartScenario: AUTO_START,
  onScenarioTerminate,
})

let observerReadyFired = false
const observerReadyPromise = new Promise<void>(resolve => {
  const unsub = gameServer.onObserverReady(() => {
    observerReadyFired = true
    unsub()
    resolve()
  })
})

if (RECORD_BOT_INDEX !== null) {
  app.get('/observe/:key/:i/:j', (req, res) => {
    const i = parseInt(req.params.i, 10)
    const j = parseInt(req.params.j, 10)
    if (!gameServer.getRouter().hasRoomAndPlayer(req.params.key, i, j)) {
      res.status(404).send('<html><body><p>not found</p></body></html>')
      return
    }
    const wsShim = `<script>
(function(){
  var _WS=window.WebSocket;
  window.WebSocket=function WS(url,protocols){
    var u=String(url).replace(/^wss?:\\/\\/[^/]+/,'ws://localhost:${PORT}');
    return protocols!==undefined?new _WS(u,protocols):new _WS(u);
  };
  window.WebSocket.CONNECTING=_WS.CONNECTING;
  window.WebSocket.OPEN=_WS.OPEN;
  window.WebSocket.CLOSING=_WS.CLOSING;
  window.WebSocket.CLOSED=_WS.CLOSED;
  window.WebSocket.prototype=_WS.prototype;
})();
</script>`
    const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8')
      .replace('<head>', `<head><base href="/">${wsShim}`)
    res.setHeader('Content-Type', 'text/html')
    res.send(html)
  })

  app.get('*', (_req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'))
  })
}

await new Promise<void>(resolve => httpServer.listen(PORT, resolve))
console.log(`[run-scenario] server on http://localhost:${PORT}`)

// ── Connect bots ──────────────────────────────────────────────────────────────

const ROUTING_KEY = `r_${SCENARIO_ID}`

const botClients: BotClient[] = []
for (const spec of botSpecs) {
  const client = new BotClient(`ws://localhost:${PORT}`, ROUTING_KEY, spec, { tickMs: TICK_MS })
  client.start()
  botClients.push(client)
  await new Promise(r => setTimeout(r, 100))
}

// Wait for bots to register on the server.
await new Promise(r => setTimeout(r, 300))

// Scenario timeouts are expressed in sim-ms; scale to wall-clock by the speed
// multiplier so a 90s / 1800-tick scenario takes 7.5s wall at 240Hz.
const simTimeoutMs = TIMEOUT_OVERRIDE ?? scenarioSpec.timeoutMs
const effectiveTimeout = simTimeoutMs / SPEED_MULTIPLIER
const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, effectiveTimeout))

// ── Optionally launch browser and record ──────────────────────────────────────

type PlaywrightModule = typeof import('playwright')
type ChromiumBrowser = Awaited<ReturnType<PlaywrightModule['chromium']['launch']>>
type BrowserContext = Awaited<ReturnType<ChromiumBrowser['newContext']>>
type CDPSession = Awaited<ReturnType<BrowserContext['newCDPSession']>>
type FfmpegProcess = ReturnType<typeof import('node:child_process')['spawn']>
let browser: ChromiumBrowser | null = null
let context: BrowserContext | null = null
let cdp: CDPSession | null = null
let ffmpeg: FfmpegProcess | null = null
let videoOutPath: string | null = null
let screenshotOutPath: string | null = null
let screenshotHasContent: boolean | null = null

if (RECORD_BOT_INDEX !== null && OUTPUT_DIR) {
  const { chromium } = await import('playwright')
  const observeUrl = `http://localhost:${PORT}/observe/${ROUTING_KEY}/0/${RECORD_BOT_INDEX}`
  console.log(`[run-scenario] observing ${observeUrl}`)

  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await context.newPage()

  page.on('console', msg => {
    if (msg.type() === 'error') console.error(`[browser:error] ${msg.text()}`)
  })
  page.on('pageerror', err => console.error(`[browser:pageerror] ${err.message}`))

  await page.goto(observeUrl)

  const OBSERVER_READY_FALLBACK_MS = 10_000
  const observerReadyResult = await Promise.race([
    observerReadyPromise.then(() => 'ready' as const),
    new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), OBSERVER_READY_FALLBACK_MS)),
  ])
  if (observerReadyResult === 'ready') {
    console.log('[run-scenario] observer ready signal received — starting screencast')
  } else {
    console.warn(`[run-scenario] observer ready signal did not arrive within ${OBSERVER_READY_FALLBACK_MS}ms — starting screencast anyway`)
  }

  console.log(`[run-scenario] recording started (timeout: ${effectiveTimeout}ms)`)

  const { spawn } = await import('node:child_process')
  videoOutPath = path.join(OUTPUT_DIR, `${RECORD_BOT_INDEX}.mp4`)
  ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(CAPTURE_FPS),
    '-i', '-',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', String(CAPTURE_FPS),
    videoOutPath,
  ])
  ffmpeg.stderr?.on('data', (_d: Buffer) => { /* noisy; drop */ })
  ffmpeg.on('error', (err: Error) => console.error(`[ffmpeg:error] ${err.message}`))

  cdp = await context.newCDPSession(page)
  const cdpSession = cdp
  const ffmpegProc = ffmpeg
  cdpSession.on('Page.screencastFrame', async (params: unknown) => {
    const { data, sessionId } = params as { data: string; sessionId: number }
    try { ffmpegProc.stdin?.write(Buffer.from(data, 'base64')) } catch { /* ignore */ }
    try { await cdpSession.send('Page.screencastFrameAck', { sessionId }) } catch { /* ignore */ }
  })
  await cdpSession.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 })

  // Observer is recording. Start the scenario — replays onPlayerConnect for
  // every bot that connected during the created-not-started phase and
  // onPlayerReady for every bot that auto-readied, in arrival order.
  // Scenario-spawned bots (bot-fill etc.) and later ready signals flow
  // through normally.
  const room = gameServer.getRouter().getRoomByIndex(ROUTING_KEY, 0)
  if (room) {
    room.startScenario(SCENARIO_ID)
    console.log('[run-scenario] scenario started')
  } else {
    console.warn('[run-scenario] no room to start — scenario will not run')
  }

  // Wait a bit, grab screenshot, verify non-black pixels.
  const SCREENSHOT_DELAY = Math.min(3_000, effectiveTimeout / 2)
  await Promise.race([new Promise(r => setTimeout(r, SCREENSHOT_DELAY)), timeoutPromise])

  const screenshotBuf = await page.screenshot()
  screenshotOutPath = path.join(OUTPUT_DIR, `${RECORD_BOT_INDEX}-screenshot.png`)
  fs.writeFileSync(screenshotOutPath, screenshotBuf)
  console.log(`[run-scenario] screenshot saved: ${screenshotOutPath}`)

  const base64 = screenshotBuf.toString('base64')
  screenshotHasContent = await page.evaluate(async (b64: string) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await new Promise<void>(resolve => { img.onload = () => resolve() })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 20 || data[i + 1] > 20 || data[i + 2] > 20) return true
    }
    return false
  }, base64)

  if (!screenshotHasContent) {
    console.error('[run-scenario] ASSERTION FAILED: screenshot is all black — observer connection or rendering is broken')
    process.exitCode = 1
  } else {
    console.log('[run-scenario] assertion passed: observer screenshot has non-black pixels')
  }
}

// ── Wait for termination or timeout ──────────────────────────────────────────

await Promise.race([terminationPromise, timeoutPromise])

// Small buffer so the final state renders in the recording
if (context) await new Promise(r => setTimeout(r, 2_000))

// ── Finalize recording ────────────────────────────────────────────────────────

if (RECORD_BOT_INDEX !== null && OUTPUT_DIR) {
  console.log('[run-scenario] stopping recording...')
  if (cdp) { try { await cdp.send('Page.stopScreencast') } catch { /* ignore */ } }
  if (context) await context.close()
  if (browser) await browser.close()
  if (ffmpeg) {
    const ffmpegProc = ffmpeg
    ffmpegProc.stdin?.end()
    await new Promise<void>(resolve => ffmpegProc.on('close', () => resolve()))
  }
  console.log(`[run-scenario] saved: ${videoOutPath}`)
}

// ── Collect bot logs (filtered by --log-bot-indices) ──────────────────────────

const cliBotLogs: LogEntry[] = botClients.flatMap((c, i) =>
  (logBotIndexSet === null || logBotIndexSet.has(i))
    ? c.logs.map(l => ({
        time: l.time,
        level: l.level,
        source: 'cli-bot' as const,
        bot_index: i,
        message: l.message,
      }))
    : [],
)
const scenarioBotLogs: LogEntry[] = gameServer.getBotManager().collectLogs().map(e => ({
  time: e.log.time,
  level: e.log.level,
  source: 'scenario-bot' as const,
  bot_index: e.clientIndex,
  message: e.log.message,
}))

const allBotLogs: LogEntry[] = [...cliBotLogs, ...scenarioBotLogs].sort((a, b) => a.time - b.time)

const serverLogEntries: LogEntry[] = serverLogs.map(e => ({
  time: e.time,
  level: e.level,
  source: 'server' as const,
  bot_index: null,
  message: e.message,
}))

// ── Build structured response ─────────────────────────────────────────────────

interface ScenarioRunResult {
  run_id: string
  output_dir: string
  config: {
    scenario_id: string
    test_spec_name: string
    index: number
    bot_count: number
    record_bot_index: number | null
    log_bot_indices: number[] | null
    effective_timeout_ms: number
  }
  logs: string
  termination_metadata: {
    terminated_by: 'scenario' | 'timeout'
    exit_code: number
    video_path: string | null
    screenshot_path: string | null
    screenshot_has_content: boolean | null
    observer_ready_fired: boolean
  }
  server_logs: string
}

const response: ScenarioRunResult = {
  run_id: RUN_ID,
  output_dir: OUTPUT_DIR ?? '',
  config: {
    scenario_id: SCENARIO_ID,
    test_spec_name: TEST_SPEC_NAME,
    index: RUN_INDEX,
    bot_count: botSpecs.length,
    record_bot_index: RECORD_BOT_INDEX,
    log_bot_indices: LOG_BOT_INDICES,
    effective_timeout_ms: effectiveTimeout,
  },
  logs: formatLogs(allBotLogs),
  termination_metadata: {
    terminated_by: terminatedByScenario ? 'scenario' : 'timeout',
    exit_code: process.exitCode ?? 0,
    video_path: videoOutPath,
    screenshot_path: screenshotOutPath,
    screenshot_has_content: screenshotHasContent,
    observer_ready_fired: observerReadyFired,
  },
  server_logs: formatLogs(serverLogEntries),
}

if (RESPONSE_JSON) {
  fs.mkdirSync(path.dirname(RESPONSE_JSON), { recursive: true })
  fs.writeFileSync(RESPONSE_JSON, JSON.stringify(response, null, 2))
  console.log(`[run-scenario] response written: ${RESPONSE_JSON}`)
}

if (OUTPUT_DIR) {
  const dupPath = path.join(OUTPUT_DIR, 'response.json')
  if (!RESPONSE_JSON || path.resolve(RESPONSE_JSON) !== path.resolve(dupPath)) {
    fs.writeFileSync(dupPath, JSON.stringify(response, null, 2))
  }
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

for (const bot of botClients) bot.stop()
httpServer.close()
process.exit(process.exitCode ?? 0)
