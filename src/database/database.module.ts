import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { loadConfig } from '../config';

export const DB = Symbol('DB');

// Table types are added per domain module as migrations introduce them.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}

export function createDb(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });
}

@Global()
@Module({
  providers: [{ provide: DB, useFactory: () => createDb(loadConfig().databaseUrl) }],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
