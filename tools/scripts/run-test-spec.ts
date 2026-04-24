// Run a persisted test spec by name.
//
// Usage:
//   npx tsx tools/scripts/run-test-spec.ts <scenario_id> <test_spec_name>
//
// Reads content/scenarios/<scenario_id>/test_specs/<test_spec_name>/spec.json,
// runs it, and prints the result JSON (run_artifact_id, survivors,
// scenario_summary) to stdout.

import { RUN_SCENARIO_FROM_SPEC_TOOL } from '../src/runScenarioFromSpec/index.js'

const scenario_id = process.argv[2]
const test_spec_name = process.argv[3]
if (!scenario_id || !test_spec_name) {
  console.error('Usage: npx tsx tools/scripts/run-test-spec.ts <scenario_id> <test_spec_name>')
  process.exit(1)
}

const result = await RUN_SCENARIO_FROM_SPEC_TOOL.run({ scenario_id, test_spec_name })
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
if ('error' in result) process.exit(1)
