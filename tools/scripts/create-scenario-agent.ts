// Create-Scenario Agent runner.
//
// Unlike the other agent scripts, this is not a model loop — it's a
// deterministic TS orchestrator. So we don't use _runAgentCli (which assumes
// AgentRunResult shape); we call the runner directly and print the structured
// response.
//
// Usage:
//   npx tsx tools/scripts/create-scenario-agent.ts "<brief>" [--verbose]

import { runCreateScenarioAgent } from '../src/agents/createScenarioAgent.js'

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

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose') || args.includes('-v')
  const positional = args.filter(a => a !== '--verbose' && a !== '-v')

  let brief = positional.join(' ').trim()
  if (!brief) brief = (await readStdin()).trim()

  if (!brief) {
    console.error('Usage: create-scenario-agent "<brief>"   (or pipe brief on stdin)')
    console.error('       create-scenario-agent "<brief>" --verbose')
    process.exit(1)
  }

  try {
    const result = await runCreateScenarioAgent(brief, { verbose })
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    if (!result.goal_achieved) process.exit(2)
  } catch (err) {
    process.stderr.write(`[create-scenario-agent] failed: ${(err as Error).message}\n`)
    process.exit(1)
  }
}

await main()
