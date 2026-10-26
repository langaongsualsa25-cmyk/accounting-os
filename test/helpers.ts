import { importPKCS8, SignJWT } from 'jose';
import { Client } from 'pg';

// Fictional sandbox ids from seeds/sandbox.sql.
export const TENANT_A = '00000000-0000-4000-8000-00000000000a';
export const TENANT_B = '00000000-0000-4000-8000-00000000000b';
export const SEED = {
  staffA: 'seed-staff-a',
  supervisorA: 'seed-supervisor-a',
  adminA: 'seed-admin-a',
  staffB: 'seed-staff-b',
  adminB: 'seed-admin-b',
  sharedSupervisor: 'seed-shared-supervisor',
} as const;

export async function token(subject: string, overrides: { issuer?: string; audience?: string } = {}): Promise<string> {
  const key = await importPKCS8(process.env.TEST_JWT_PRIVATE_KEY!, 'RS256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(subject)
    .setIssuer(overrides.issuer ?? process.env.JWT_ISSUER!)
    .setAudience(overrides.audience ?? process.env.JWT_AUDIENCE!)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

export async function connect(url: string): Promise<Client> {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

// Opens a transaction on c as the given caller, in the given tenant.
export async function actAs(c: Client, subject: string | null, tenantId: string | null = null): Promise<void> {
  await c.query('begin');
  await c.query("select set_config('app.subject', $1, true), set_config('app.tenant_id', $2, true)", [
    subject ?? '',
    tenantId ?? '',
  ]);
}
