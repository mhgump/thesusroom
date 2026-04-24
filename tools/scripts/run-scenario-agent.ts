// Run-Scenario Agent runner.
//
// Usage:
//   npx tsx tools/scripts/run-scenario-agent.ts "<prompt>" [--verbose]

import { runRunScenarioAgent } from '../src/agents/runScenarioAgent.js'
import { runAgentCli } from './_runAgentCli.js'

await runAgentCli({ name: 'run-scenario-agent', run: runRunScenarioAgent })
