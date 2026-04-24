import type { DataBackend } from '../dataBackend.js'

// Stub. The interface is here to prove the primitive has no filesystem-isms;
// real wiring (pg driver, schema, connection pool) lands when we pick up the
// Postgres backing work.
export class PostgresDataBackend implements DataBackend {
  readList<T>(_key: string): Promise<T[]> {
    throw new Error('PostgresDataBackend: not implemented')
  }
  writeList<T>(_key: string, _items: T[]): Promise<void> {
    throw new Error('PostgresDataBackend: not implemented')
  }
  appendToList<T>(_key: string, _item: T): Promise<number> {
    throw new Error('PostgresDataBackend: not implemented')
  }
  removeFromList<T>(_key: string, _item: T): Promise<void> {
    throw new Error('PostgresDataBackend: not implemented')
  }
  listCount(_key: string): Promise<number> {
    throw new Error('PostgresDataBackend: not implemented')
  }
  listIndexOf<T>(_key: string, _item: T): Promise<number> {
    throw new Error('PostgresDataBackend: not implemented')
  }
  readJson<T>(_key: string): Promise<T | null> {
    throw new Error('PostgresDataBackend: not implemented')
  }
  writeJson<T>(_key: string, _value: T): Promise<void> {
    throw new Error('PostgresDataBackend: not implemented')
  }
  deleteJson(_key: string): Promise<void> {
    throw new Error('PostgresDataBackend: not implemented')
  }
}
