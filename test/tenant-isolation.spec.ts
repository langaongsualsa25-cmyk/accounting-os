// Project rule 6 and blueprint §12 acceptance: company A must never see
// company B's data. Checked at the database layer as app_user, for every
// table that carries tenant_id (discovered from the catalogue).
import { Client } from 'pg';
import { actAs, connect, SEED, TENANT_A, TENANT_B } from './helpers';

describe('tenant isolation (RLS)', () => {
  let admin: Client;
  let app: Client;
  let tenantTables: string[];

  beforeAll(async () => {
    admin = await connect(process.env.ADMIN_DATABASE_URL!);
    app = await connect(process.env.DATABASE_URL!);
    tenantTables = (
      await admin.query(`
        select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
        where n.nspname = 'public' and c.relkind = 'r' order by 1`)
    ).rows.map((r) => r.relname);
  });

  afterEach(() => app.query('rollback'));
  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  async function countByTenant(table: string): Promise<{ a: number; b: number }> {
    const { rows } = await app.query(
      `select count(*) filter (where tenant_id = $1)::int as a, count(*) filter (where tenant_id <> $1)::int as b from ${table}`,
      [TENANT_A],
    );
    return rows[0];
  }

  it('has seed rows for both companies in every tenant table (so the checks below mean something)', async () => {
    expect(tenantTables.length).toBeGreaterThan(0);
    for (const table of tenantTables) {
      const { rows } = await admin.query(
        `select count(*) filter (where tenant_id = $1)::int as a, count(*) filter (where tenant_id = $2)::int as b from ${table}`,
        [TENANT_A, TENANT_B],
      );
      expect({ table, ...rows[0], a: rows[0].a > 0, b: rows[0].b > 0 }).toEqual({ table, a: true, b: true });
    }
  });

  it('a user of company A sees only company A rows in every tenant table', async () => {
    await actAs(app, SEED.staffA, TENANT_A);
    for (const table of tenantTables) {
      const counts = await countByTenant(table);
      expect({ table, b: counts.b, seesA: counts.a > 0 }).toEqual({ table, b: 0, seesA: true });
    }
  });

  it('a user of company A who asks for company B sees nothing at all', async () => {
    await actAs(app, SEED.staffA, TENANT_B);
    for (const table of tenantTables) {
      expect({ table, ...(await countByTenant(table)) }).toEqual({ table, a: 0, b: 0 });
    }
    const tenants = (await app.query('select id from tenants')).rows.map((r) => r.id);
    expect(tenants).toEqual([TENANT_A]);
  });

  it('a user who works for both companies sees only the company in the current context', async () => {
    await actAs(app, SEED.sharedSupervisor, TENANT_A);
    for (const table of tenantTables) {
      const counts = await countByTenant(table);
      expect({ table, b: counts.b }).toEqual({ table, b: 0 });
    }
  });

  it('without an authenticated subject nothing is visible, not even tenants or users', async () => {
    await actAs(app, null, TENANT_A);
    for (const table of [...tenantTables, 'tenants', 'users']) {
      const { rows } = await app.query(`select count(*)::int as n from ${table}`);
      expect({ table, n: rows[0].n }).toEqual({ table, n: 0 });
    }
  });

  it('users of another company are not visible', async () => {
    await actAs(app, SEED.staffA, TENANT_A);
    const subjects = (await app.query('select external_subject from users order by 1')).rows.map((r) => r.external_subject);
    expect(subjects).not.toContain(SEED.staffB);
    expect(subjects).not.toContain(SEED.adminB);
    expect(subjects).toContain(SEED.staffA);
  });

  it('cannot write a row into another company even with an explicit tenant_id', async () => {
    await actAs(app, SEED.adminA, TENANT_A);
    await expect(
      app.query("insert into departments (tenant_id, code, name) values ($1, 'X', 'แทรกข้ามบริษัท')", [TENANT_B]),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot update or delete another company rows (they match nothing)', async () => {
    await actAs(app, SEED.adminA, TENANT_A);
    const upd = await app.query("update departments set name = 'hacked' where tenant_id = $1", [TENANT_B]);
    const del = await app.query('delete from departments where tenant_id = $1', [TENANT_B]);
    expect([upd.rowCount, del.rowCount]).toEqual([0, 0]);
  });

  it('a link between a user in company A and a department of company B is impossible', async () => {
    await expect(
      admin.query(
        `insert into user_department_access (tenant_id, user_id, department_id)
         values ($1, '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000b0001')`,
        [TENANT_A],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe('RBAC levels (blueprint §3)', () => {
  let app: Client;

  beforeAll(async () => {
    app = await connect(process.env.DATABASE_URL!);
  });
  afterEach(() => app.query('rollback'));
  afterAll(() => app.end());

  it('staff cannot create a department', async () => {
    await actAs(app, SEED.staffA, TENANT_A);
    await expect(app.query("insert into departments (tenant_id, code, name) values ($1, 'NEW', 'ใหม่')", [TENANT_A])).rejects.toThrow(
      /row-level security/,
    );
  });

  it('company admin can create a department in their own company', async () => {
    await actAs(app, SEED.adminA, TENANT_A);
    const { rowCount } = await app.query("insert into departments (tenant_id, code, name) values ($1, 'NEW', 'ใหม่')", [TENANT_A]);
    expect(rowCount).toBe(1);
  });

  it('company admin cannot grant a role above their own level', async () => {
    await actAs(app, SEED.adminA, TENANT_A);
    await expect(
      app.query(
        "update user_tenant_access set role_id = 'super_admin' where tenant_id = $1 and user_id = '00000000-0000-4000-8000-000000000101'",
        [TENANT_A],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('supervisor cannot change anyone’s access', async () => {
    await actAs(app, SEED.supervisorA, TENANT_A);
    const { rowCount } = await app.query(
      "update user_tenant_access set role_id = 'supervisor' where tenant_id = $1 and user_id = '00000000-0000-4000-8000-000000000101'",
      [TENANT_A],
    );
    expect(rowCount).toBe(0);
  });

  it('app_user cannot create tenants or users directly', async () => {
    await actAs(app, SEED.adminA, TENANT_A);
    await expect(app.query("insert into tenants (code, name) values ('X', 'X')")).rejects.toThrow(/permission denied/);
  });
});
