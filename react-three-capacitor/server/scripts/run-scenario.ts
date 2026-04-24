/**
 * Run a single scenario against an already-running multiplayer server.
 *
 * The thin client:
 *  1) POSTs a run spec to /scenario-run on the main server, which registers
 *     a one-shot routing key `scenariorun/<id>` and a one-shot room behind it.
 *  2) Connects CLI-driven bots over WebSocket to that routing key.
 *  3) Optionally launches Playwright + ffmpeg against
 *     http://<host>/observe/<key>/0/<recordBotIndex> to record video.
 *  4) Long-polls GET /scenario-run/:id/result until the server reports the
 *     run terminated, then merges CLI-bot logs and writes response.json.
 *
 * Requires the main server to be running on $SERVER_URL (default
 * http://localhost:8080). If the server isn't up, start it first:
 *   cd react-three-capacitor/server && npm run dev
 *
 * Recording additionally requires a built frontend so the main server can
 * serve /observe:
 *   cd react-three-capacitor && npm run build
 * and playwright chromium installed:
 *   npx playwright install chromium
 *
 * Usage (from react-three-capacitor/server/):
 *   npx tsx scripts/run-scenario.ts \
 *     [--scenario <id>]               default: scenario2
 *     [--bots <path:Export> ...]      bot specs relative to project root
 *     [--record-bot-index <n>]        enables video recording
 *     [--log-bot-indices <csv>]       default: all bots. "" for none.
 *     [--output-dir <dir>]            video / screenshot / response.json
 *     [--response-json <file>]        override response.json path
 *     [--timeout <ms>]                override scenario sim-ms timeout
 *     [--tick-rate-hz <hz>]           default: 240
 *     [--capture-fps <hz>]            default: 60
 *     [--server-url <url>]            default: $SERVER_URL or http://localhost:8080
 *     [--run-id <id>]                 default: <scenario>/<test-spec>/<index>
 *     [--test-spec-name <name>]       default: _adhoc
 *     [--run-index <n>]               default: 0
 */

import { parseArgs } from 'node:util'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BotClient } from '../src/bot/BotClient.js'
import { formatLogs, type LogEntry } from './logFormat.js'
import type { BotSpec } from '../src/bot/BotTypes.js'
import type { ScenarioRunRequest, ScenarioRunRegistered, ScenarioRunServerResult } from '../src/scenarioRun/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

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
    'server-url':        { type: 'string'                   },
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
const TIMEOUT_OVERRIDE = values.timeout ? parseInt(values.timeout, 10) : null

const TICK_RATE_HZ = parseFloat(values['tick-rate-hz'] ?? '240')
if (!Number.isFinite(TICK_RATE_HZ) || TICK_RATE_HZ <= 0) {
  console.error(`--tick-rate-hz must be > 0 — got ${values['tick-rate-hz']}`)
  process.exit(1)
}
const TICK_MS = 1000 / TICK_RATE_HZ
const CAPTURE_FPS = parseFloat(values['capture-fps'] ?? '60')
if (!Number.isFinite(CAPTURE_FPS) || CAPTURE_FPS <= 0) {
  console.error(`--capture-fps must be > 0 — got ${values['capture-fps']}`)
  process.exit(1)
}

const SERVER_URL = (values['server-url'] ?? process.env.SERVER_URL ?? 'http://localhost:8080').replace(/\/+$/, '')
const WS_URL = SERVER_URL.replace(/^http/, 'ws')

// Parse --log-bot-indices: undefined → all bots, "" → none, "0,2" → [0, 2]
const LOG_BOT_INDICES: number[] | null = values['log-bot-indices'] === undefined
  ? null
  : values['log-bot-indices'] === ''
    ? []
    : values['log-bot-indices'].split(',').map(s => parseInt(s.trim(), 10))

console.log('[run-scenario] server=%s tickRateHz=%d tickMs=%s captureFps=%d', SERVER_URL, TICK_RATE_HZ, TICK_MS.toFixed(3), CAPTURE_FPS)

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

if (OUTPUT_DIR) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

// ── Register the run with the server ──────────────────────────────────────────

const registerReq: ScenarioRunRequest = {
  run_id: RUN_ID,
  scenario_id: SCENARIO_ID,
  test_spec_name: TEST_SPEC_NAME,
  run_index: RUN_INDEX,
  bot_count: botSpecs.length,
  record_bot_index: RECORD_BOT_INDEX,
  log_bot_indices: LOG_BOT_INDICES,
  timeout_ms: TIMEOUT_OVERRIDE,
  tick_rate_hz: TICK_RATE_HZ,
}

async function postRegister(): Promise<ScenarioRunRegistered> {
  const res = await fetch(`${SERVER_URL}/scenario-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registerReq),
  })
  if (res.status !== 201) {
    const text = await res.text()
    throw new Error(`POST /scenario-run failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<ScenarioRunRegistered>
}

let registered: ScenarioRunRegistered
try {
  registered = await postRegister()
} catch (err) {
  console.error(`[run-scenario] register failed: ${err instanceof Error ? err.message : err}`)
  console.error(`[run-scenario] is the server running at ${SERVER_URL}?`)
  process.exit(1)
}

const ROUTING_KEY = registered.routing_key
const ROUTING_RUN_ID = registered.routing_run_id
console.log(`[run-scenario] registered: routingKey=${ROUTING_KEY} effectiveTimeout=${registered.effective_timeout_ms}ms`)

// ── Connect CLI-driven bots ──────────────────────────────────────────────────

const botClients: BotClient[] = []
for (const spec of botSpecs) {
  const client = new BotClient(WS_URL, ROUTING_KEY, spec, { tickMs: TICK_MS })
  client.start()
  botClients.push(client)
  await new Promise(r => setTimeout(r, 100))
}

// Let bots register on the server.
await new Promise(r => setTimeout(r, 300))

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
  const observeUrl = `${SERVER_URL}/observe/${ROUTING_KEY}/0/${RECORD_BOT_INDEX}`
  console.log(`[run-scenario] observing ${observeUrl}`)

  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await context.newPage()

  page.on('console', msg => {
    if (msg.type() === 'error') console.error(`[browser:error] ${msg.text()}`)
  })
  page.on('pageerror', err => console.error(`[browser:pageerror] ${err.message}`))

  await page.goto(observeUrl)
  console.log(`[run-scenario] recording started (server timeout: ${registered.effective_timeout_ms}ms)`)

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

  // Grab screenshot shortly after start, verify non-black pixels.
  const SCREENSHOT_DELAY = Math.min(3_000, registered.effective_timeout_ms / 2)
  await new Promise(r => setTimeout(r, SCREENSHOT_DELAY))

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

// ── Wait for termination by long-polling the server ──────────────────────────

async function awaitResult(): Promise<ScenarioRunServerResult> {
  // Hard cap well beyond the server's own timeout so a pathological hang
  // surfaces as a CLI-side error instead of an infinite poll.
  const deadline = Date.now() + Math.max(60_000, registered.effective_timeout_ms * 3)
  while (Date.now() < deadline) {
    const res = await fetch(`${SERVER_URL}/scenario-run/${ROUTING_RUN_ID}/result`)
    if (res.status === 200) return res.json() as Promise<ScenarioRunServerResult>
    if (res.status === 202) continue
    const text = await res.text()
    throw new Error(`GET /scenario-run/${ROUTING_RUN_ID}/result: ${res.status} ${text}`)
  }
  throw new Error(`timed out waiting for result from ${SERVER_URL}`)
}

const serverResult = await awaitResult()

// ── Finalize recording ────────────────────────────────────────────────────────

if (RECORD_BOT_INDEX !== null && OUTPUT_DIR) {
  // Small buffer so the final state renders in the recording
  if (context) await new Promise(r => setTimeout(r, 2_000))

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

// ── Merge logs ────────────────────────────────────────────────────────────────

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

const allBotLogs: LogEntry[] = [...cliBotLogs, ...serverResult.scenario_bot_logs].sort((a, b) => a.time - b.time)

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
    final_state: {
      survivor_count: number
      survivor_player_ids: string[]
    }
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
    effective_timeout_ms: serverResult.effective_timeout_ms,
  },
  logs: formatLogs(allBotLogs),
  termination_metadata: {
    terminated_by: serverResult.termination_metadata.terminated_by,
    exit_code: serverResult.termination_metadata.exit_code,
    video_path: videoOutPath,
    screenshot_path: screenshotOutPath,
    screenshot_has_content: screenshotHasContent,
    observer_ready_fired: serverResult.termination_metadata.observer_ready_fired,
    final_state: serverResult.termination_metadata.final_state,
  },
  server_logs: formatLogs(serverResult.server_logs),
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
process.exit(process.exitCode ?? 0)
