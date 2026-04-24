import type { Backends } from '../backends.js'
import {
  FilesystemBotBackend,
  FilesystemMapBackend,
  FilesystemScenarioBackend,
  FilesystemTestSpecBackend,
} from '../filesystem/index.js'
import { PostgresScenarioRunResultBackend } from './scenarioRunResultBackend.js'

export { PostgresDataBackend } from './dataBackend.js'
export { PostgresScenarioRunResultBackend } from './scenarioRunResultBackend.js'

// TS-source content (bot, map, scenario, testSpec) is baked into the Docker
// image at build time and the deployed server only reads it via dynamic
// import, which needs a real filesystem path — so those delegate to the
// filesystem backends. Scenario run results are runtime writes that must
// survive instance replacement, so they live in Postgres (response.json as
// jsonb, mp4 / png as gzip-compressed bytea).
export class PostgresBackends implements Backends {
  bot = new FilesystemBotBackend()
  map = new FilesystemMapBackend()
  scenario = new FilesystemScenarioBackend()
  testSpec = new FilesystemTestSpecBackend()
  scenarioRunResult = new PostgresScenarioRunResultBackend()
}
