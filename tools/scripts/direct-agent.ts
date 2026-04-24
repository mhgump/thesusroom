// Direct Modification Agent runner.
//
// Usage:
//   npx tsx tools/scripts/direct-agent.ts "<prompt>" [--verbose]

import { runDirectAgent } from '../src/agents/directAgent.js'
import { runAgentCli } from './_runAgentCli.js'

await runAgentCli({ name: 'direct-agent', run: runDirectAgent })
