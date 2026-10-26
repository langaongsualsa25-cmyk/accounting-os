// Project rule 6 / blueprint §3, §11: every table enforces Row-Level
// Security. This guard inspects the catalogue so that any table added by a
// future migration fails the build until it has RLS and the right policies.
import { Client } from 'pg';
import { connect } from './helpers';

// Identity catalogue without tenant_id (a user can work for several
// companies). Anything else must carry tenant_id.
const GLOBAL_TABLES = ['permissions', 'role_permissions', 'roles', 'tenants', 'users'];
const NOT_EXPOSED = ['schema_migrations'];

describe('RLS coverage', () => {
  let admin: Client;
  let tables: { name: string; rls: boolean; forced: boolean; hasTenantId: boolean }[];

  beforeAll(async () => {
    admin = await connect(process.env.ADMIN_DATABASE_URL!);
    tables = (
      await admin.query(`
        select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
               exists (select 1 from pg_attribute a
                       where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as "hasTenantId"
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by 1`)
    ).rows;
  });

  afterAll(() => admin.end());

  it('enables and forces RLS on every table', () => {
    const missing = tables.filter((t) => !NOT_EXPOSED.includes(t.name) && !(t.rls && t.forced)).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it('gives tenant_id to every table outside the identity catalogue', () => {
    const missing = tables
      .filter((t) => !t.hasTenantId && !GLOBAL_TABLES.includes(t.name) && !NOT_EXPOSED.includes(t.name))
      .map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it('filters every tenant table by app.current_tenant_id() in all its policies', async () => {
    const tenantTables = tables.filter((t) => t.hasTenantId).map((t) => t.name);
    const { rows } = await admin.query<{ tablename: string; policyname: string; qual: string | null; with_check: string | null }>(
      `select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename = any($1)`,
      [tenantTables],
    );
    for (const table of tenantTables) {
      expect(rows.some((p) => p.tablename === table)).toBe(true);
    }
    const unscoped = rows.filter((p) => {
      const exprs = [p.qual, p.with_check].filter((e): e is string => e !== null);
      return !exprs.every((e) => e.includes('current_tenant_id()'));
    });
    expect(unscoped.map((p) => `${p.tablename}.${p.policyname}`)).toEqual([]);
  });

  it('gives app_user no access to schema_migrations', async () => {
    const { rows } = await admin.query(
      "select has_table_privilege('app_user', 'schema_migrations', 'select') as can_read",
    );
    expect(rows[0].can_read).toBe(false);
  });
});
