// Blueprint §3 and §12 acceptance through the HTTP API: authentication,
// company selection and cross-company access.
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SEED, TENANT_A, TENANT_B, token } from './helpers';

describe('identity API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  it('rejects requests without a token', async () => {
    await http().get('/me/tenants').expect(401);
  });

  it('rejects tokens from another issuer or audience', async () => {
    await http().get('/me/tenants').auth(await token(SEED.staffA, { issuer: 'https://evil.example' }), { type: 'bearer' }).expect(401);
    await http().get('/me/tenants').auth(await token(SEED.staffA, { audience: 'other-app' }), { type: 'bearer' }).expect(401);
  });

  it('lists only the companies the caller works for', async () => {
    const res = await http().get('/me/tenants').auth(await token(SEED.staffA), { type: 'bearer' }).expect(200);
    expect(res.body).toEqual([expect.objectContaining({ id: TENANT_A, role: 'staff' })]);

    const shared = await http().get('/me/tenants').auth(await token(SEED.sharedSupervisor), { type: 'bearer' }).expect(200);
    expect(shared.body.map((t: { id: string }) => t.id)).toEqual([TENANT_A, TENANT_B]);
  });

  it('returns departments of the selected company only', async () => {
    const res = await http()
      .get('/departments')
      .set('X-Tenant-Id', TENANT_A)
      .auth(await token(SEED.staffA), { type: 'bearer' })
      .expect(200);
    expect(res.body.map((d: { code: string }) => d.code)).toEqual(expect.arrayContaining(['ACC', 'TAX']));
    expect(res.body.every((d: { id: string }) => d.id.includes('0000000a'))).toBe(true);
  });

  it('forbids selecting a company the caller does not work for', async () => {
    await http().get('/departments').set('X-Tenant-Id', TENANT_B).auth(await token(SEED.staffA), { type: 'bearer' }).expect(403);
  });

  it('requires a valid X-Tenant-Id', async () => {
    await http().get('/departments').auth(await token(SEED.staffA), { type: 'bearer' }).expect(400);
    await http().get('/departments').set('X-Tenant-Id', 'nope').auth(await token(SEED.staffA), { type: 'bearer' }).expect(400);
  });

  it('lets only a company admin create a department', async () => {
    await http()
      .post('/departments')
      .set('X-Tenant-Id', TENANT_B)
      .auth(await token(SEED.staffB), { type: 'bearer' })
      .send({ code: 'PAY', name: 'เงินเดือน' })
      .expect(403);
    const res = await http()
      .post('/departments')
      .set('X-Tenant-Id', TENANT_B)
      .auth(await token(SEED.adminB), { type: 'bearer' })
      .send({ code: 'PAY', name: 'เงินเดือน' })
      .expect(201);
    expect(res.body).toEqual(expect.objectContaining({ code: 'PAY', name: 'เงินเดือน' }));

    const fromA = await http().get('/departments').set('X-Tenant-Id', TENANT_A).auth(await token(SEED.adminA), { type: 'bearer' }).expect(200);
    expect(fromA.body.map((d: { code: string }) => d.code)).not.toContain('PAY');
  });
});
