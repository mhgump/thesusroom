/**
 * Run a single scenario with a given set of bots and record a video of one bot's POV.
 *
 * Usage (from react-three-capacitor/server/):
 *   npx tsx scripts/run-scenario.ts \
 *     [--scenario <id>]               default: demo
 *     [--bots <path:Export> ...]      bot specs relative to project root, e.g.
 *                                     content/bots/demo/demoBot.ts:DEMO_BOT
 *     [--record-bot-index <n>]        which connected bot to observe (0-indexed), default: 0
 *     [--output <file>]               output video path, default: recording.webm
 *
 * Requires the frontend to be built first:
 *   cd react-three-capacitor && npm run build
 *
 * Requires playwright chromium:
 *   npx playwright install chromium
 */

import { parseArgs } from 'node:util'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import express from 'express'
import { chromium } from 'playwright'
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
    scenario:           { type: 'string',  default: 'demo' },
    bots:               { type: 'string',  multiple: true  },
    'record-bot-index': { type: 'string',  default: '0'    },
    output:             { type: 'string',  default: 'recording.webm' },
    timeout:            { type: 'string'                              },
  },
  strict: true,
})

const SCENARIO_ID      = values.scenario ?? 'demo'
const BOT_ARGS         = values.bots ?? []
const RECORD_BOT_INDEX = parseInt(values['record-bot-index'] ?? '0', 10)
const OUTPUT           = path.resolve(process.cwd(), values.output ?? 'recording.webm')
const TIMEOUT_OVERRIDE = values.timeout ? parseInt(values.timeout, 10) : undefined

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

// ── Validate frontend build ───────────────────────────────────────────────────

const staticDir = path.resolve(__dirname, '../../dist')
if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
  console.error(`Frontend build not found at ${staticDir}`)
  console.error('Run: cd react-three-capacitor && npm run build')
  process.exit(1)
}

// ── Register termination callback before GameServer starts ────────────────────

let terminationResolve!: () => void
const terminationPromise = new Promise<void>(resolve => { terminationResolve = resolve })
scenarioSpec.onTerminate(terminationResolve)

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
app.use(express.static(staticDir))

const httpServer = http.createServer(app)
const gameServer = new GameServer(httpServer, PORT)

app.get('/observe/:scenario/:i/:j', (req, res) => {
  const i = parseInt(req.params.i, 10)
  const j = parseInt(req.params.j, 10)
  if (!gameServer.getRegistry().hasRoomAndPlayer(req.params.scenario, i, j)) {
    res.status(404).send('<html><body><p>not found</p></body></html>')
    return
  }
  // The Vite build uses base: './' so assets are relative — inject <base href="/"> so
  // they resolve correctly when served from /observe/demo/0/0.
  //
  // The bundle also has VITE_WS_URL baked in as the production host. Inject a
  // WebSocket redirect shim that rewrites any ws(s):// URL to the local server.
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

await new Promise<void>(resolve => httpServer.listen(PORT, resolve))
console.log(`[run-scenario] server on http://localhost:${PORT}`)

// ── Connect bots ──────────────────────────────────────────────────────────────

const botClients: BotClient[] = []
for (const spec of botSpecs) {
  const client = new BotClient(`ws://localhost:${PORT}`, SCENARIO_ID, spec)
  client.start()
  botClients.push(client)
  // Small delay so connections land in order (determines player index)
  await new Promise(r => setTimeout(r, 100))
}

// Wait for the first bot (the one we'll observe) to register on the server.
// Keep this short — the observer must connect before closeScenario() fires.
await new Promise(r => setTimeout(r, 300))

// ── Launch browser and record ─────────────────────────────────────────────────

const observeUrl = `http://localhost:${PORT}/observe/${SCENARIO_ID}/0/${RECORD_BOT_INDEX}`
console.log(`[run-scenario] observing ${observeUrl}`)

const outputDir = path.dirname(OUTPUT)
fs.mkdirSync(outputDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  recordVideo: { dir: outputDir, size: { width: 1280, height: 720 } },
})
const page = await context.newPage()
const video = page.video()

page.on('console', msg => {
  if (msg.type() === 'error') console.error(`[browser:error] ${msg.text()}`)
})
page.on('pageerror', err => console.error(`[browser:pageerror] ${err.message}`))

await page.goto(observeUrl)
const effectiveTimeout = TIMEOUT_OVERRIDE ?? scenarioSpec.timeoutMs
console.log(`[run-scenario] recording started (timeout: ${effectiveTimeout}ms)`)

// Start the timeout from navigation time so --timeout reflects total scenario duration.
const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, effectiveTimeout))

// ── Assert observer is rendering non-black pixels ─────────────────────────────

// Wait for the game canvas to initialise and render at least one frame.
const SCREENSHOT_DELAY = Math.min(3_000, effectiveTimeout / 2)
await Promise.race([new Promise(r => setTimeout(r, SCREENSHOT_DELAY)), timeoutPromise])

const screenshotBuf = await page.screenshot()
const screenshotPath = OUTPUT.replace(/\.webm$/, '-screenshot.png')
fs.writeFileSync(screenshotPath, screenshotBuf)
console.log(`[run-scenario] screenshot saved: ${screenshotPath}`)
const base64 = screenshotBuf.toString('base64')
const hasContent = await page.evaluate(async (b64: string) => {
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

if (!hasContent) {
  console.error('[run-scenario] ASSERTION FAILED: screenshot is all black — observer connection or rendering is broken')
  process.exitCode = 1
} else {
  console.log('[run-scenario] assertion passed: observer screenshot has non-black pixels')
}

// ── Wait for termination or timeout ──────────────────────────────────────────

await Promise.race([terminationPromise, timeoutPromise])

// Small buffer so the final state renders in the recording
await new Promise(r => setTimeout(r, 2_000))

console.log('[run-scenario] stopping recording...')

// ── Finalize recording ────────────────────────────────────────────────────────

await context.close()
await browser.close()

if (video) {
  const tempPath = await video.path()
  fs.renameSync(tempPath, OUTPUT)
  console.log(`[run-scenario] saved: ${OUTPUT}`)
} else {
  console.warn('[run-scenario] no video captured')
}

// ── Collect and print bot logs ────────────────────────────────────────────────

const allLogs = [
  ...botClients.flatMap((c, i) => c.logs.map(l => ({ clientIndex: i, source: 'cli-bot', log: l }))),
  ...gameServer.getBotManager().collectLogs().map(e => ({ ...e, source: 'scenario-bot' })),
]
allLogs.sort((a, b) => a.log.time - b.log.time)

if (allLogs.length > 0) {
  console.log('\n[run-scenario] bot logs:')
  for (const { source, clientIndex, log } of allLogs) {
    const ts = new Date(log.time).toISOString().slice(11, 23)
    console.log(`  [${ts}] [${source}#${clientIndex}] ${log.level.toUpperCase()} ${log.message}`)
  }
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

for (const bot of botClients) bot.stop()
httpServer.close()
process.exit(process.exitCode ?? 0)
