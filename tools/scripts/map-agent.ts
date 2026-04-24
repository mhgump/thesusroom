// Map Agent runner.
//
// Usage:
//   npx tsx tools/scripts/map-agent.ts "<prompt>" [--verbose]
//
// Requires:
//   - gcloud authed (gcloud auth login)
//   - VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) env var set

import { runMapAgent } from '../src/agents/mapAgent.js'
import { runAgentCli } from './_runAgentCli.js'

await runAgentCli({ name: 'map-agent', run: runMapAgent })
