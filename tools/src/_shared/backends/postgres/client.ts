import type { Pool } from 'pg'

// Cached singleton. Initialized lazily so filesystem-mode deploys never import
// or connect to `pg`.
let pool: Pool | null = null
let bootstrapped: Promise<void> | null = null

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is required for DATA_BACKEND=postgres`)
  return v
}

// Schema name becomes part of DDL and SET search_path statements. Restrict to
// a conservative identifier alphabet so it cannot smuggle SQL.
function validateSchema(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`POSTGRES_SCHEMA must match [a-zA-Z_][a-zA-Z0-9_]*: got ${JSON.stringify(name)}`)
  }
  return name
}

export function currentSchema(): string {
  return validateSchema(requireEnv('POSTGRES_SCHEMA'))
}

export async function getPool(): Promise<Pool> {
  if (pool) {
    await bootstrapped
    return pool
  }
  const { Pool: PgPool } = await import('pg')
  const schema = currentSchema()
  pool = new PgPool({
    host: requireEnv('POSTGRES_HOST'),
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: requireEnv('POSTGRES_USER'),
    password: requireEnv('POSTGRES_PASSWORD'),
    database: process.env.POSTGRES_DATABASE ?? 'postgres',
    // Every checkout lands with the cluster's schema first in the search path,
    // so callers can use unqualified table names.
    options: `-c search_path=${schema},public`,
    max: Number(process.env.POSTGRES_POOL_MAX ?? 10),
  })
  bootstrapped = bootstrap(pool, schema).catch(err => {
    bootstrapped = null
    pool = null
    throw err
  })
  await bootstrapped
  return pool
}

async function bootstrap(p: Pool, schema: string): Promise<void> {
  const ddl = `
    CREATE SCHEMA IF NOT EXISTS "${schema}";
    CREATE TABLE IF NOT EXISTS "${schema}".kv_json (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "${schema}".kv_list (
      key text NOT NULL,
      idx integer NOT NULL,
      value jsonb NOT NULL,
      PRIMARY KEY (key, idx)
    );
    CREATE INDEX IF NOT EXISTS kv_list_key_idx ON "${schema}".kv_list (key);
    CREATE TABLE IF NOT EXISTS "${schema}".scenario_runs (
      scenario text NOT NULL,
      test_spec text NOT NULL,
      idx integer NOT NULL,
      response jsonb NOT NULL,
      PRIMARY KEY (scenario, test_spec, idx)
    );
    CREATE TABLE IF NOT EXISTS "${schema}".scenario_run_blobs (
      scenario text NOT NULL,
      test_spec text NOT NULL,
      idx integer NOT NULL,
      filename text NOT NULL,
      content_gz bytea NOT NULL,
      PRIMARY KEY (scenario, test_spec, idx, filename)
    );
  `
  await p.query(ddl)
}
