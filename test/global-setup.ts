// Creates a fresh test database on a real PostgreSQL server, runs all
// migrations, loads the fictional sandbox seed, and exposes to the tests:
//   ADMIN_DATABASE_URL – migration/owner role (for schema assertions, fixtures)
//   DATABASE_URL       – app_user, the role the application runs as
//   JWT_*              – a throwaway signing key pair for test tokens
// RLS can only be verified against real PostgreSQL, so the DB is never mocked.
import { generateKeyPairSync } from 'node:crypto';
import { Client } from 'pg';
import { migrate } from '../scripts/migrate';
import { seed } from '../scripts/seed';

const TEST_DB = 'accounting_os_test';
const APP_PASSWORD = 'app_test_only';

export default async function globalSetup(): Promise<void> {
  const serverUrl = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const admin = new Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const adminUrl = withDatabase(serverUrl, TEST_DB);
  await migrate(adminUrl, { appUserPassword: APP_PASSWORD });
  await seed(adminUrl);

  const appUrl = new URL(adminUrl);
  appUrl.username = 'app_user';
  appUrl.password = APP_PASSWORD;

  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.ADMIN_DATABASE_URL = adminUrl;
  process.env.DATABASE_URL = appUrl.toString();
  process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  process.env.TEST_JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  process.env.JWT_ISSUER = 'https://keycloak.test/realms/accounting-os';
  process.env.JWT_AUDIENCE = 'accounting-os-api';
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}
