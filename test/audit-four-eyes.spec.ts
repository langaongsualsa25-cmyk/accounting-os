// Blueprint §1 ข้อห้าม, §6 (Version Control, Four-Eyes Review, Immutable
// Audit) and §12 acceptance, checked at the database layer as app_user.
import { Client } from 'pg';
import { actAs, connect, SEED, TENANT_A, TENANT_B } from './helpers';

const STAFF_A_ID = '00000000-0000-4000-8000-000000000101';
const ADMIN_A_ID = '00000000-0000-4000-8000-000000000103';
const DEPT_TAX_A = '00000000-0000-4000-8000-0000000a0002';

describe('immutable audit log', () => {
  let admin: Client;
  let app: Client;

  beforeAll(async () => {
    admin = await connect(process.env.ADMIN_DATABASE_URL!);
    app = await connect(process.env.DATABASE_URL!);
  });
  afterEach(() => app.query('rollback'));
  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  it('records old value, new value, editor, reason and time for a change', async () => {
    await actAs(app, SEED.adminA, TENANT_A);
    await app.query("select set_config('app.change_reason', 'แก้ชื่อตามหนังสือรับรอง', true)");
    await app.query("update departments set name = 'บัญชีและการเงิน' where id = '00000000-0000-4000-8000-0000000a0001'");
    const { rows } = await app.query(
      "select action, actor_user_id, actor_subject, before_data->>'name' as before, after_data->>'name' as after, reason, occurred_at " +
        "from audit_logs where entity_type = 'departments' and entity_id = '00000000-0000-4000-8000-0000000a0001' order by seq desc limit 1",
    );
    expect(rows[0]).toEqual(
      expect.objectContaining({
        action: 'update',
        actor_user_id: ADMIN_A_ID,
        actor_subject: SEED.adminA,
        before: 'บัญชี',
        after: 'บัญชีและการเงิน',
        reason: 'แก้ชื่อตามหนังสือรับรอง',
      }),
    );
    expect(rows[0].occurred_at).toBeInstanceOf(Date);
  });

  it('app_user cannot insert, update or delete audit rows', async () => {
    await actAs(app, SEED.adminA, TENANT_A);
    await expect(
      app.query("insert into audit_logs (tenant_id, seq, action, entity_type, hash) values ($1, 999, 'x', 'x', '')", [TENANT_A]),
    ).rejects.toThrow(/permission denied/);
    await app.query('rollback');
    await actAs(app, SEED.adminA, TENANT_A);
    await expect(app.query("update audit_logs set reason = 'x'")).rejects.toThrow(/permission denied/);
    await app.query('rollback');
    await actAs(app, SEED.adminA, TENANT_A);
    await expect(app.query('delete from audit_logs')).rejects.toThrow(/permission denied/);
  });

  it('even the table owner cannot update, delete or truncate audit rows', async () => {
    await admin.query('begin');
    try {
      await expect(admin.query("update audit_logs set reason = 'x' where seq = 1")).rejects.toThrow(/append-only/);
    } finally {
      await admin.query('rollback');
    }
    await admin.query('begin');
    try {
      await expect(admin.query('delete from audit_logs')).rejects.toThrow(/append-only/);
    } finally {
      await admin.query('rollback');
    }
    await admin.query('begin');
    try {
      await expect(admin.query('truncate audit_logs')).rejects.toThrow(/append-only/);
    } finally {
      await admin.query('rollback');
    }
  });

  it('the hash chain verifies, and detects an edit made by bypassing the triggers', async () => {
    const ok = await admin.query('select app.verify_audit_chain($1) as broken', [TENANT_A]);
    expect(ok.rows[0].broken).toBeNull();

    await admin.query('begin');
    try {
      // Simulates an attacker with superuser access disabling triggers.
      await admin.query("set local session_replication_role = 'replica'");
      await admin.query("update audit_logs set reason = 'ปลอมแปลง' where tenant_id = $1 and seq = 2", [TENANT_A]);
      const { rows } = await admin.query('select app.verify_audit_chain($1) as broken', [TENANT_A]);
      expect(rows[0].broken).toBe('2');
    } finally {
      await admin.query('rollback');
    }
  });

  it('each company has its own chain', async () => {
    const { rows } = await admin.query(
      'select tenant_id, min(seq)::int as first, count(*)::int = max(seq)::int as gapless from audit_logs group by tenant_id order by 1',
    );
    expect(rows).toEqual([
      { tenant_id: TENANT_A, first: 1, gapless: true },
      { tenant_id: TENANT_B, first: 1, gapless: true },
    ]);
  });

  it('staff cannot read the audit log; a supervisor can', async () => {
    await actAs(app, SEED.staffA, TENANT_A);
    expect((await app.query('select count(*)::int as n from audit_logs')).rows[0].n).toBe(0);
    await app.query('rollback');
    await actAs(app, SEED.supervisorA, TENANT_A);
    expect((await app.query('select count(*)::int as n from audit_logs')).rows[0].n).toBeGreaterThan(0);
  });
});

describe('four-eyes change requests', () => {
  let app: Client;

  beforeAll(async () => {
    app = await connect(process.env.DATABASE_URL!);
  });
  afterEach(() => app.query('rollback'));
  afterAll(() => app.end());

  async function propose(subject: string): Promise<string> {
    await actAs(app, subject, TENANT_A);
    const { rows } = await app.query(
      `insert into change_requests (tenant_id, entity_type, entity_id, proposed, reason)
       values ($1, 'department', $2, '{"name": "ภาษีอากร"}', 'ตามคำขอลูกค้า') returning id, requested_by`,
      [TENANT_A, DEPT_TAX_A],
    );
    return rows[0].id;
  }

  it('records the caller as requester, whatever the client sends', async () => {
    await actAs(app, SEED.staffA, TENANT_A);
    const { rows } = await app.query(
      `insert into change_requests (tenant_id, entity_type, proposed, reason, requested_by)
       values ($1, 'department', '{}', 'r', $2) returning requested_by`,
      [TENANT_A, ADMIN_A_ID],
    );
    expect(rows[0].requested_by).toBe(STAFF_A_ID);
  });

  it('requires a reason', async () => {
    await actAs(app, SEED.staffA, TENANT_A);
    await expect(
      app.query("insert into change_requests (tenant_id, entity_type, proposed, reason) values ($1, 'x', '{}', '  ')", [TENANT_A]),
    ).rejects.toThrow(/check constraint/);
  });

  it('the requester cannot approve their own change, even with approve permission', async () => {
    const id = await propose(SEED.supervisorA);
    await expect(app.query("update change_requests set status = 'approved' where id = $1", [id])).rejects.toThrow(/four-eyes/);
  });

  it('another supervisor can approve, and the decision is recorded', async () => {
    const id = await propose(SEED.staffA);
    await app.query("select set_config('app.subject', $1, true)", [SEED.supervisorA]);
    const { rows } = await app.query(
      "update change_requests set status = 'approved' where id = $1 returning status, decided_by, decided_at",
      [id],
    );
    expect(rows[0]).toEqual(expect.objectContaining({ status: 'approved', decided_by: '00000000-0000-4000-8000-000000000102' }));
  });

  it('staff without approve permission cannot decide', async () => {
    const id = await propose(SEED.supervisorA);
    await app.query("select set_config('app.subject', $1, true)", [SEED.staffA]);
    await expect(app.query("update change_requests set status = 'approved' where id = $1", [id])).rejects.toThrow(
      /change\.approve/,
    );
  });

  it('a decided request is final and a request cannot be edited', async () => {
    const id = await propose(SEED.staffA);
    await expect(app.query(`update change_requests set proposed = '{"name": "อื่น"}' where id = $1`, [id])).rejects.toThrow(
      /cannot be edited/,
    );
    await app.query('rollback');
    const id2 = await propose(SEED.staffA);
    await app.query("select set_config('app.subject', $1, true)", [SEED.supervisorA]);
    await app.query("update change_requests set status = 'rejected', decision_note = 'แนบหลักฐาน' where id = $1", [id2]);
    await expect(app.query("update change_requests set status = 'approved' where id = $1", [id2])).rejects.toThrow(/already rejected/);
  });

  it('change requests cannot be deleted', async () => {
    await actAs(app, SEED.adminA, TENANT_A);
    await expect(app.query('delete from change_requests')).rejects.toThrow(/permission denied|append-only/);
  });

  it('the database itself refuses decided_by = requested_by', async () => {
    const admin = await connect(process.env.ADMIN_DATABASE_URL!);
    try {
      await admin.query('begin');
      // Bypass the guard trigger to prove the CHECK constraint holds on its own.
      await admin.query("set local session_replication_role = 'replica'");
      await expect(
        admin.query(
          `insert into change_requests (tenant_id, entity_type, proposed, reason, requested_by, status, decided_by, decided_at)
           values ($1, 'x', '{}', 'r', $2, 'approved', $2, now())`,
          [TENANT_A, STAFF_A_ID],
        ),
      ).rejects.toThrow(/four_eyes/);
    } finally {
      await admin.query('rollback');
      await admin.end();
    }
  });
});

describe('record versions', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await connect(process.env.ADMIN_DATABASE_URL!);
  });
  afterEach(() => admin.query('rollback'));
  afterAll(() => admin.end());

  it('cannot be modified, only closed once with effective_to', async () => {
    await admin.query('begin');
    await expect(
      admin.query(`update record_versions set data = '{"name": "x"}' where id = '00000000-0000-4000-8000-0000000ae001'`),
    ).rejects.toThrow(/immutable/);
    await admin.query('rollback');
    await admin.query('begin');
    await admin.query("update record_versions set effective_to = now() where id = '00000000-0000-4000-8000-0000000ae001'");
    await expect(
      admin.query("update record_versions set effective_to = now() + interval '1 day' where id = '00000000-0000-4000-8000-0000000ae001'"),
    ).rejects.toThrow(/immutable/);
  });

  it('cannot be deleted', async () => {
    await admin.query('begin');
    await expect(admin.query('delete from record_versions')).rejects.toThrow(/append-only/);
  });

  it('rejects a version approved by its own creator', async () => {
    await admin.query('begin');
    await expect(
      admin.query(
        `insert into record_versions (tenant_id, entity_type, entity_id, version, data, created_by, approved_by)
         values ($1, 'department', $2, 2, '{}', $3, $3)`,
        [TENANT_A, DEPT_TAX_A, STAFF_A_ID],
      ),
    ).rejects.toThrow(/four_eyes/);
  });
});
