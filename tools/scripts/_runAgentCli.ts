// Shared CLI entry for the agent runner scripts.
//
// Each wrapper (map-agent.ts, scenario-agent.ts, ...) passes its agent runner
// here; this handles argv parsing, stdin fallback, and JSON output.

import type { AgentRunResult } from '../../shared/agentLoop.js'

export interface RunnerCliOptions<T> {
  // Name used in `Usage:` output and log prefix.
  name: string
  // The agent-runner function (one of runMapAgent, runBotAgent, ...).
  run: (prompt: string, opts: { verbose?: boolean; maxIterations?: number }) => Promise<AgentRunResult<T>>
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) return resolve('')
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

export async function runAgentCli<T>(opts: RunnerCliOptions<T>): Promise<void> {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose') || args.includes('-v')
  const positional = args.filter(a => a !== '--verbose' && a !== '-v')

  let prompt = positional.join(' ').trim()
  if (!prompt) prompt = (await readStdin()).trim()

  if (!prompt) {
    console.error(`Usage: ${opts.name} "<prompt>"   (or pipe prompt on stdin)`)
    console.error(`       ${opts.name} "<prompt>" --verbose`)
    process.exit(1)
  }

  try {
    const result = await opts.run(prompt, { verbose })
    // Final JSON goes to stdout, transcript only to stderr if --verbose.
    process.stdout.write(JSON.stringify(result.response, null, 2) + '\n')
    if (verbose) {
      process.stderr.write(`\n[${opts.name}] completed in ${result.iterations} iterations\n`)
    }
  } catch (err) {
    process.stderr.write(`[${opts.name}] failed: ${(err as Error).message}\n`)
    process.exit(1)
  }
}
