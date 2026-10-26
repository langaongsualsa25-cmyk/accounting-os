// Blueprint §3, §10: the application role must not be able to bypass
// Row-Level Security or change the schema.
import { Client } from 'pg';
import { migrate } from '../scripts/migrate';

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describe('migrations', () => {
  it('are idempotent: a second run applies nothing', async () => {
    expect(await migrate(process.env.ADMIN_DATABASE_URL!)).toEqual([]);
  });

  it('record every applied file', async () => {
    const names = await withClient(process.env.ADMIN_DATABASE_URL!, async (c) =>
      (await c.query('select name from schema_migrations order by name')).rows.map((r) => r.name),
    );
    expect(names).toContain('0001_baseline.sql');
  });
});

describe('app_user role', () => {
  it('is not a superuser and cannot bypass RLS', async () => {
    const row = await withClient(process.env.DATABASE_URL!, async (c) =>
      (await c.query('select rolsuper, rolbypassrls from pg_roles where rolname = current_user')).rows[0],
    );
    expect(row).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('cannot create tables', async () => {
    await withClient(process.env.DATABASE_URL!, async (c) => {
      await expect(c.query('create table sneaky (id int)')).rejects.toThrow(/permission denied/);
    });
  });
});
