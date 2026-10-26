import { Controller, ForbiddenException, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContext } from '../auth/principal.decorator';
import { DB } from '../database/database.module';
import { hasPermission, RequestContext, withContext } from '../database/request-context';
import { Database } from '../database/schema';

// Blueprint §6 Immutable Audit and §12: who created, edited, reviewed and
// approved what, with old and new values. Read-only by design.
@Controller('audit-logs')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  @Get()
  list(
    @TenantContext() ctx: RequestContext,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
  ) {
    return withContext(this.db, ctx, async (trx) => {
      await this.requireAuditRead(trx);
      let q = trx
        .selectFrom('audit_logs')
        .select([
          'seq',
          'occurred_at',
          'actor_user_id',
          'actor_subject',
          'action',
          'entity_type',
          'entity_id',
          'before_data',
          'after_data',
          'reason',
        ])
        .orderBy('seq', 'desc')
        .limit(200);
      if (entityType) q = q.where('entity_type', '=', entityType);
      if (entityId) q = q.where('entity_id', '=', entityId);
      return q.execute();
    });
  }

  @Get('verify')
  verify(@TenantContext() ctx: RequestContext) {
    return withContext(this.db, ctx, async (trx) => {
      await this.requireAuditRead(trx);
      const { rows } = await sql<{ broken: string | null }>`select app.verify_audit_chain(${ctx.tenantId}::uuid) as broken`.execute(trx);
      const broken = rows[0]?.broken ?? null;
      return { valid: broken === null, brokenAtSeq: broken === null ? null : Number(broken) };
    });
  }

  private async requireAuditRead(trx: Parameters<Parameters<typeof withContext>[2]>[0]): Promise<void> {
    if (!(await hasPermission(trx, 'audit.read'))) {
      throw new ForbiddenException('Missing permission audit.read');
    }
  }
}
