import type { DataBackend } from './dataBackend.js'
import { FilesystemDataBackend } from './filesystem/index.js'

let cached: DataBackend | null = null

export function getDataBackend(): DataBackend {
  if (cached) return cached
  const kind = process.env.DATA_BACKEND ?? 'filesystem'
  switch (kind) {
    case 'filesystem': {
      cached = new FilesystemDataBackend()
      return cached
    }
    case 'postgres':
      throw new Error('DATA_BACKEND=postgres not implemented')
    default:
      throw new Error(`unknown DATA_BACKEND: ${kind}`)
  }
}

export * from './types.js'
export * from './keyValueBackend.js'
export * from './dataBackend.js'
