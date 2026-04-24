import type { DataBackend } from '../dataBackend.js'

const KEY = 'vetted_scenarios'

export class VettedScenarios {
  constructor(private readonly data: DataBackend) {}

  async markScenarioVetted(scenario_id: string): Promise<void> {
    const existing = await this.data.listIndexOf(KEY, scenario_id)
    if (existing !== -1) return
    await this.data.appendToList(KEY, scenario_id)
  }

  markScenarioUnvetted(scenario_id: string): Promise<void> {
    return this.data.removeFromList(KEY, scenario_id)
  }

  listVettedScenarios(): Promise<string[]> {
    return this.data.readList<string>(KEY)
  }
}
