import type { DataBackend } from '../dataBackend.js'

export class TestSpecList {
  constructor(private readonly data: DataBackend) {}

  private key(scenario_id: string): string {
    return `scenarios/${scenario_id}/test_specs`
  }

  async addTestSpec(scenario_id: string, test_spec_id: string): Promise<number> {
    const key = this.key(scenario_id)
    const existing = await this.data.listIndexOf(key, test_spec_id)
    if (existing !== -1) return existing
    return this.data.appendToList(key, test_spec_id)
  }

  deleteTestSpec(scenario_id: string, test_spec_id: string): Promise<void> {
    return this.data.removeFromList(this.key(scenario_id), test_spec_id)
  }

  listTestSpecs(scenario_id: string): Promise<string[]> {
    return this.data.readList<string>(this.key(scenario_id))
  }
}
