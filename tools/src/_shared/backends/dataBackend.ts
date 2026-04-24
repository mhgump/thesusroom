// Generic durable-storage primitive. Two families of operations:
//
//   1. Keyed lists — a named list of JSON-serializable items with
//      append/remove/count/index semantics. Used by the ScenarioList,
//      VettedScenarios, TestSpecList, and AgentConversations domain classes
//      in ./ops/.
//
//   2. Keyed JSON documents — a named single JSON value.
//
// Keys are opaque strings. FilesystemDataBackend interprets them as relative
// paths under content/ (writing `content/{key}.json`); PostgresDataBackend
// interprets them as primary keys in backing tables. Item equality in
// removeFromList/listIndexOf is structural (JSON.stringify compare) so that
// both primitives and plain objects behave predictably.
export interface DataBackend {
  // Keyed list ops
  readList<T>(key: string): Promise<T[]>
  writeList<T>(key: string, items: T[]): Promise<void>
  appendToList<T>(key: string, item: T): Promise<number>
  removeFromList<T>(key: string, item: T): Promise<void>
  listCount(key: string): Promise<number>
  listIndexOf<T>(key: string, item: T): Promise<number>

  // Keyed JSON-document ops
  readJson<T>(key: string): Promise<T | null>
  writeJson<T>(key: string, value: T): Promise<void>
  deleteJson(key: string): Promise<void>
}
