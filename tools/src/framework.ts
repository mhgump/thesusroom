// Framework for declaring agent-callable tools and invoking them by name.
//
// Each tool has a JSON-schema-shaped spec (suitable for passing to an LLM as a
// tool-use definition) and an async implementation that takes the validated
// input and returns a JSON-serialisable result.
//
// Agent loops import { getToolSpecs, callTool } and drive the full catalogue
// without needing to know about individual tool modules.

export interface JsonSchemaObject {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface ToolSpec {
  name: string
  description: string
  input_schema: JsonSchemaObject
}

export interface Tool<I = unknown, O = unknown> {
  spec: ToolSpec
  run: (input: I) => Promise<O>
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>()

  register(tool: Tool): void {
    if (this.tools.has(tool.spec.name)) {
      throw new Error(`Tool already registered: ${tool.spec.name}`)
    }
    this.tools.set(tool.spec.name, tool)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  getSpecs(): ToolSpec[] {
    return [...this.tools.values()].map(t => t.spec)
  }

  async call(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    return tool.run(input)
  }
}
