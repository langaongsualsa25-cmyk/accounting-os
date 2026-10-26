// Creates a fresh test database on a real PostgreSQL server, runs all
// migrations, and exposes two connection strings to the tests:
//   ADMIN_DATABASE_URL – migration/owner role (for assertions about schema)
//   DATABASE_URL       – app_user, the role the application runs as
// RLS can only be verified against real PostgreSQL, so the DB is never mocked.
import { Client } from 'pg';
import { migrate } from '../scripts/migrate';

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

  const appUrl = new URL(adminUrl);
  appUrl.username = 'app_user';
  appUrl.password = APP_PASSWORD;

  process.env.ADMIN_DATABASE_URL = adminUrl;
  process.env.DATABASE_URL = appUrl.toString();
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}
