// Loads the fictional sandbox seed (seeds/sandbox.sql). Never point this at
// a database that holds real client data.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export const SANDBOX_SEED = join(process.cwd(), 'seeds', 'sandbox.sql');

export async function seed(connectionString: string, file = SANDBOX_SEED): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(readFileSync(file, 'utf8'));
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');
  seed(url)
    .then(() => console.log('Sandbox seed loaded'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
