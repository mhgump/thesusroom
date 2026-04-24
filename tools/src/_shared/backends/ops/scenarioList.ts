import type { DataBackend } from '../dataBackend.js'
import type { VettedScenarios } from './vettedScenarios.js'

const KEY = 'scenario_map'

export class ScenarioList {
  constructor(
    private readonly data: DataBackend,
    private readonly vetted: VettedScenarios,
  ) {}

  async addScenario(scenario_id: string): Promise<number> {
    const existing = await this.data.listIndexOf(KEY, scenario_id)
    if (existing !== -1) return existing
    return this.data.appendToList(KEY, scenario_id)
  }

  // Also removes the scenario from the vetted list if it's there — otherwise
  // the vetted list can outlive the scenario it references.
  async deleteScenario(scenario_id: string): Promise<void> {
    await this.vetted.markScenarioUnvetted(scenario_id)
    await this.data.removeFromList(KEY, scenario_id)
  }

  listScenarios(): Promise<string[]> {
    return this.data.readList<string>(KEY)
  }

  indexOfScenario(scenario_id: string): Promise<number> {
    return this.data.listIndexOf(KEY, scenario_id)
  }
}
