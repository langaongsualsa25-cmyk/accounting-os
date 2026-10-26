// Blueprint §6 Four-Eyes Review and Immutable Audit through the HTTP API.
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SEED, TENANT_A, TENANT_B, token } from './helpers';

const DEPT_TAX_A = '00000000-0000-4000-8000-0000000a0002';

describe('change requests and audit API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  const as = async (subject: string, tenant = TENANT_A) => {
    const t = await token(subject);
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('X-Tenant-Id', tenant).auth(t, { type: 'bearer' }),
      post: (url: string, body: object = {}) =>
        request(server).post(url).set('X-Tenant-Id', tenant).auth(t, { type: 'bearer' }).send(body),
    };
  };

  async function propose(subject: string) {
    const res = await (await as(subject))
      .post('/change-requests', {
        entityType: 'department',
        entityId: DEPT_TAX_A,
        proposed: { name: 'ภาษีอากร' },
        reason: 'ตามหนังสือรับรองฉบับใหม่ (สมมติ)',
      })
      .expect(201);
    return res.body;
  }

  it('creates a pending request with the caller as requester', async () => {
    const cr = await propose(SEED.staffA);
    expect(cr).toEqual(expect.objectContaining({ status: 'pending', requested_by: '00000000-0000-4000-8000-000000000101' }));
  });

  it('refuses a request without a reason', async () => {
    await (await as(SEED.staffA)).post('/change-requests', { entityType: 'department', proposed: {} }).expect(400);
  });

  it('returns 403 when the requester tries to approve their own change', async () => {
    const cr = await propose(SEED.supervisorA);
    const res = await (await as(SEED.supervisorA)).post(`/change-requests/${cr.id}/approve`).expect(403);
    expect(res.body.message).toMatch(/four-eyes/);
  });

  it('lets another supervisor approve, then refuses a second decision with 409', async () => {
    const cr = await propose(SEED.staffA);
    const ok = await (await as(SEED.supervisorA)).post(`/change-requests/${cr.id}/approve`, { note: 'ตรวจแล้ว' }).expect(201);
    expect(ok.body).toEqual(expect.objectContaining({ status: 'approved', decided_by: '00000000-0000-4000-8000-000000000102' }));
    await (await as(SEED.adminA)).post(`/change-requests/${cr.id}/reject`, { note: 'x' }).expect(409);
  });

  it('requires a note to reject', async () => {
    const cr = await propose(SEED.staffA);
    await (await as(SEED.supervisorA)).post(`/change-requests/${cr.id}/reject`).expect(400);
  });

  it('cannot see or decide another company’s requests', async () => {
    const cr = await propose(SEED.staffA);
    const list = await (await as(SEED.adminB, TENANT_B)).get('/change-requests').expect(200);
    expect(list.body.map((r: { id: string }) => r.id)).not.toContain(cr.id);
    await (await as(SEED.adminB, TENANT_B)).post(`/change-requests/${cr.id}/approve`).expect(404);
  });

  it('shows the full trail in the audit log: proposal, decision, editor and reason', async () => {
    const cr = await propose(SEED.staffA);
    await (await as(SEED.supervisorA)).post(`/change-requests/${cr.id}/approve`, { note: 'ตรวจเอกสารครบ' }).expect(201);
    const res = await (await as(SEED.supervisorA)).get(`/audit-logs?entityType=change_requests&entityId=${cr.id}`).expect(200);
    expect(res.body.map((r: { action: string; actor_subject: string; reason: string }) => [r.action, r.actor_subject, r.reason])).toEqual([
      ['update', SEED.supervisorA, 'ตรวจเอกสารครบ'],
      ['insert', SEED.staffA, 'ตามหนังสือรับรองฉบับใหม่ (สมมติ)'],
    ]);
    expect(res.body[0].before_data.status).toBe('pending');
    expect(res.body[0].after_data.status).toBe('approved');
  });

  it('reports the audit chain as valid, and hides the log from staff', async () => {
    const res = await (await as(SEED.supervisorA)).get('/audit-logs/verify').expect(200);
    expect(res.body).toEqual({ valid: true, brokenAtSeq: null });
    await (await as(SEED.staffA)).get('/audit-logs').expect(403);
  });
});
