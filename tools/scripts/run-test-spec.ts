// Run a persisted test spec by name.
//
// Usage:
//   npx tsx tools/scripts/run-test-spec.ts <test_spec_name>
//
// Reads content/test_specs/<name>.json, runs it, and prints the result
// JSON (run_artifact_id, survivors, scenario_summary) to stdout.

import { RUN_SCENARIO_FROM_SPEC_TOOL } from '../src/runScenarioFromSpec/index.js'

const name = process.argv[2]
if (!name) {
  console.error('Usage: npx tsx tools/scripts/run-test-spec.ts <test_spec_name>')
  process.exit(1)
}

const result = await RUN_SCENARIO_FROM_SPEC_TOOL.run({ test_spec_name: name })
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
if ('error' in result) process.exit(1)
