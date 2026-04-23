/**
 * Run a single scenario with a given set of bots.
 *
 * Usage (from react-three-capacitor/server/):
 *   npx tsx scripts/run-scenario.ts \
 *     [--scenario <id>]               default: demo
 *     [--bots <path:Export> ...]      bot specs relative to project root, e.g.
 *                                     content/bots/demo/demoBot.ts:DEMO_BOT
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
import { BotClient } from '../src/bot/BotClient.js'
import { DEMO_SCENARIO } from '../../../content/scenarios/demo.js'
import { SCENARIO1_SCENARIO } from '../../../content/scenarios/scenario1.js'
import { SCENARIO2_SCENARIO } from '../../../content/scenarios/scenario2.js'
import { SCENARIO3_SCENARIO } from '../../../content/scenarios/scenario3.js'
import { SCENARIO4_SCENARIO } from '../../../content/scenarios/scenario4.js'
import type { BotSpec } from '../src/bot/BotTypes.js'
import type { ScenarioSpec } from '../src/ScenarioRegistry.js'

const SCENARIO_SPECS: Record<string, ScenarioSpec> = {
  demo: DEMO_SCENARIO,
  scenario1: SCENARIO1_SCENARIO,
  scenario2: SCENARIO2_SCENARIO,
  scenario3: SCENARIO3_SCENARIO,
  scenario4: SCENARIO4_SCENARIO,
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

// ── CLI args ──────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    scenario:            { type: 'string',  default: 'demo' },
    bots:                { type: 'string',  multiple: true  },
    'record-bot-index':  { type: 'string'                   },
    'log-bot-indices':   { type: 'string'                   },
    'output-dir':        { type: 'string'                   },
    'response-json':     { type: 'string'                   },
    timeout:             { type: 'string'                   },
  },
  strict: true,
})

const SCENARIO_ID      = values.scenario ?? 'demo'
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
const TIMEOUT_OVERRIDE = values.timeout ? parseInt(values.timeout, 10) : undefined

// Parse --log-bot-indices: undefined → all bots, "" → none, "0,2" → [0, 2]
const LOG_BOT_INDICES: number[] | null = values['log-bot-indices'] === undefined
  ? null  // sentinel for "all"
  : values['log-bot-indices'] === ''
    ? []
    : values['log-bot-indices'].split(',').map(s => parseInt(s.trim(), 10))

// ── Validate scenario ─────────────────────────────────────────────────────────

const scenarioSpec = SCENARIO_SPECS[SCENARIO_ID]
if (!scenarioSpec) {
  console.error(`Unknown scenario: ${SCENARIO_ID}. Available: ${Object.keys(SCENARIO_SPECS).join(', ')}`)
  process.exit(1)
}

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
scenarioSpec.onTerminate(() => {
  terminatedByScenario = true
  terminationResolve()
})

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
const gameServer = new GameServer(httpServer, PORT)

if (RECORD_BOT_INDEX !== null) {
  app.get('/observe/:scenario/:i/:j', (req, res) => {
    const i = parseInt(req.params.i, 10)
    const j = parseInt(req.params.j, 10)
    if (!gameServer.getRegistry().hasRoomAndPlayer(req.params.scenario, i, j)) {
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

const botClients: BotClient[] = []
for (const spec of botSpecs) {
  const client = new BotClient(`ws://localhost:${PORT}`, SCENARIO_ID, spec)
  client.start()
  botClients.push(client)
  await new Promise(r => setTimeout(r, 100))
}

// Wait for bots to register on the server.
await new Promise(r => setTimeout(r, 300))

const effectiveTimeout = TIMEOUT_OVERRIDE ?? scenarioSpec.timeoutMs
const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, effectiveTimeout))

// ── Optionally launch browser and record ──────────────────────────────────────

type ChromiumBrowser = Awaited<ReturnType<typeof import('playwright')['chromium']['launch']>>
type BrowserContext = Awaited<ReturnType<ChromiumBrowser['newContext']>>
let browser: ChromiumBrowser | null = null
let context: BrowserContext | null = null
let videoHandle: ReturnType<Awaited<ReturnType<BrowserContext['newPage']>>['video']> | null = null
let videoOutPath: string | null = null
let screenshotOutPath: string | null = null
let screenshotHasContent: boolean | null = null

if (RECORD_BOT_INDEX !== null && OUTPUT_DIR) {
  const { chromium } = await import('playwright')
  const observeUrl = `http://localhost:${PORT}/observe/${SCENARIO_ID}/0/${RECORD_BOT_INDEX}`
  console.log(`[run-scenario] observing ${observeUrl}`)

  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({
    recordVideo: { dir: OUTPUT_DIR, size: { width: 1280, height: 720 } },
  })
  const page = await context.newPage()
  videoHandle = page.video()

  page.on('console', msg => {
    if (msg.type() === 'error') console.error(`[browser:error] ${msg.text()}`)
  })
  page.on('pageerror', err => console.error(`[browser:pageerror] ${err.message}`))

  await page.goto(observeUrl)
  console.log(`[run-scenario] recording started (timeout: ${effectiveTimeout}ms)`)

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

if (context && browser && videoHandle && OUTPUT_DIR && RECORD_BOT_INDEX !== null) {
  console.log('[run-scenario] stopping recording...')
  await context.close()
  await browser.close()
  const tempPath = await videoHandle.path()
  videoOutPath = path.join(OUTPUT_DIR, `${RECORD_BOT_INDEX}.webm`)
  fs.renameSync(tempPath, videoOutPath)
  console.log(`[run-scenario] saved: ${videoOutPath}`)
}

// ── Collect bot logs (filtered by --log-bot-indices) ──────────────────────────

const cliBotLogs = botClients.flatMap((c, i) =>
  (logBotIndexSet === null || logBotIndexSet.has(i))
    ? c.logs.map(l => ({ clientIndex: i, source: 'cli-bot' as const, log: l }))
    : [],
)
const scenarioBotLogs = gameServer.getBotManager().collectLogs().map(e => ({
  ...e, source: 'scenario-bot' as const,
}))

const allLogs = [...cliBotLogs, ...scenarioBotLogs].sort((a, b) => a.log.time - b.log.time)

if (allLogs.length > 0) {
  console.log('\n[run-scenario] bot logs:')
  for (const { source, clientIndex, log } of allLogs) {
    const ts = new Date(log.time).toISOString().slice(11, 23)
    console.log(`  [${ts}] [${source}#${clientIndex}] ${log.level.toUpperCase()} ${log.message}`)
  }
}

// ── Build structured response ─────────────────────────────────────────────────

const response = {
  scenario_id: SCENARIO_ID,
  bot_count: botSpecs.length,
  record_bot_index: RECORD_BOT_INDEX,
  log_bot_indices: LOG_BOT_INDICES,
  effective_timeout_ms: effectiveTimeout,
  terminated_by: terminatedByScenario ? 'scenario' as const : 'timeout' as const,
  logs: allLogs.map(({ source, clientIndex, log }) => ({
    time: log.time,
    level: log.level,
    source,
    bot_index: clientIndex,
    message: log.message,
  })),
  video_path: videoOutPath,
  screenshot_path: screenshotOutPath,
  screenshot_has_content: screenshotHasContent,
  exit_code: process.exitCode ?? 0,
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
