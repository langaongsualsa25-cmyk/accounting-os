import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database, DB } from '../database/database.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  @Get()
  async check(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      await sql`select 1`.execute(this.db);
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
    return { status: 'ok', database: 'ok' };
  }
}
