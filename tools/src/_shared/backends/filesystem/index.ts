import type { Backends } from '../index.js'
import { FilesystemBotBackend } from './botBackend.js'
import { FilesystemMapBackend } from './mapBackend.js'
import { FilesystemScenarioBackend } from './scenarioBackend.js'
import { FilesystemScenarioRunResultBackend } from './scenarioRunResultBackend.js'
import { FilesystemTestSpecBackend } from './testSpecBackend.js'

export { FilesystemBotBackend } from './botBackend.js'
export { FilesystemMapBackend } from './mapBackend.js'
export { FilesystemScenarioBackend } from './scenarioBackend.js'
export { FilesystemScenarioRunResultBackend } from './scenarioRunResultBackend.js'
export { FilesystemTestSpecBackend } from './testSpecBackend.js'

export function createFilesystemBackends(): Backends {
  return {
    bot: new FilesystemBotBackend(),
    map: new FilesystemMapBackend(),
    scenario: new FilesystemScenarioBackend(),
    testSpec: new FilesystemTestSpecBackend(),
    scenarioRunResult: new FilesystemScenarioRunResultBackend(),
  }
}
