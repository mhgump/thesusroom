// Scenario Agent runner.
//
// Usage:
//   npx tsx tools/scripts/scenario-agent.ts "<prompt>" [--verbose]

import { runScenarioAgent } from '../src/agents/scenarioAgent.js'
import { runAgentCli } from './_runAgentCli.js'

await runAgentCli({ name: 'scenario-agent', run: runScenarioAgent })
