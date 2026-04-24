// Scenario Plan Agent runner.
//
// Usage:
//   npx tsx tools/scripts/scenario-plan-agent.ts "<prompt>" [--verbose]

import { runScenarioPlanAgent } from '../src/agents/scenarioPlanAgent.js'
import { runAgentCli } from './_runAgentCli.js'

await runAgentCli({ name: 'scenario-plan-agent', run: runScenarioPlanAgent })
