// Bot Agent runner.
//
// Usage:
//   npx tsx tools/scripts/bot-agent.ts "<prompt>" [--verbose]

import { runBotAgent } from '../src/agents/botAgent.js'
import { runAgentCli } from './_runAgentCli.js'

await runAgentCli({ name: 'bot-agent', run: runBotAgent })
