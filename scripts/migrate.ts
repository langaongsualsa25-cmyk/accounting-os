// Applies SQL migrations in migrations/ in filename order, once each.
// Migrations are plain SQL so that RLS policies, roles and triggers are
// explicit and reviewable (blueprint §10, §11).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? join(process.cwd(), 'migrations');

export interface MigrateOptions {
  dir?: string;
  // Password for the runtime app_user role. Kept out of migration files so
  // no credential is ever committed.
  appUserPassword?: string;
}

export async function migrate(connectionString: string, options: MigrateOptions = {}): Promise<string[]> {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const client = new Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`);
    // Serialise concurrent runners (e.g. several app containers starting).
    await client.query('select pg_advisory_lock(7346001)');
    const done = new Set(
      (await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name),
    );
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query('begin');
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    if (options.appUserPassword) {
      await client.query(`alter role app_user password ${client.escapeLiteral(options.appUserPassword)}`);
    }
  } finally {
    await client.query('select pg_advisory_unlock(7346001)').catch(() => undefined);
    await client.end();
  }
  return applied;
}

if (require.main === module) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');
  migrate(url, { appUserPassword: process.env.APP_DB_PASSWORD })
    .then((applied) => console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Up to date'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
