export interface KeyValueBackend<K, V> {
  get(key: K): Promise<V | null>
  put(key: K, value: V): Promise<void>
  delete(key: K): Promise<void>
  list(): Promise<{ key: K; value: V }[]>
  // Optional capability: return an on-disk location for this key so callers
  // that need sibling files (e.g., video/screenshot for a run) can find them.
  // Backends that don't map to disk return null.
  locate?(key: K): string | null
}
