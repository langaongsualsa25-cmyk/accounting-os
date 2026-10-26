import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Kysely } from 'kysely';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContext } from '../auth/principal.decorator';
import { DB } from '../database/database.module';
import { RequestContext, withContext } from '../database/request-context';
import { ChangeRequestStatus, Database } from '../database/schema';

interface CreateChangeRequestBody {
  entityType?: unknown;
  entityId?: unknown;
  baseVersion?: unknown;
  proposed?: unknown;
  reason?: unknown;
}

interface DecisionBody {
  note?: unknown;
}

const COLUMNS = [
  'id',
  'entity_type',
  'entity_id',
  'base_version',
  'proposed',
  'reason',
  'status',
  'requested_by',
  'requested_at',
  'decided_by',
  'decided_at',
  'decision_note',
] as const;

const STATUSES: ChangeRequestStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

// Blueprint §6 Four-Eyes Review: proposals to change important data are
// decided by someone other than the proposer. The rule itself is enforced
// by the database (change_requests.four_eyes + guard trigger).
@Controller('change-requests')
@UseGuards(JwtAuthGuard)
export class ChangeRequestsController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  @Get()
  list(@TenantContext() ctx: RequestContext, @Query('status') status?: string) {
    if (status !== undefined && !STATUSES.includes(status as ChangeRequestStatus)) {
      throw new BadRequestException(`status must be one of ${STATUSES.join(', ')}`);
    }
    return withContext(this.db, ctx, (trx) => {
      let q = trx.selectFrom('change_requests').select(COLUMNS).orderBy('requested_at', 'desc');
      if (status) q = q.where('status', '=', status as ChangeRequestStatus);
      return q.execute();
    });
  }

  @Post()
  create(@TenantContext() ctx: RequestContext, @Body() body: CreateChangeRequestBody) {
    const entityType = typeof body.entityType === 'string' ? body.entityType.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const entityId = typeof body.entityId === 'string' ? body.entityId : null;
    const baseVersion = Number.isInteger(body.baseVersion) ? (body.baseVersion as number) : null;
    if (!entityType || !reason || typeof body.proposed !== 'object' || body.proposed === null) {
      throw new BadRequestException('entityType, proposed (object) and reason are required');
    }
    return withContext(
      this.db,
      ctx,
      (trx) =>
        trx
          .insertInto('change_requests')
          .values({
            tenant_id: ctx.tenantId!,
            entity_type: entityType,
            entity_id: entityId,
            base_version: baseVersion,
            proposed: JSON.stringify(body.proposed),
            reason,
          })
          .returning(COLUMNS)
          .executeTakeFirstOrThrow(),
      { reason },
    );
  }

  @Post(':id/approve')
  approve(@TenantContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionBody) {
    return this.decide(ctx, id, 'approved', body);
  }

  @Post(':id/reject')
  reject(@TenantContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionBody) {
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note) {
      throw new BadRequestException('a rejection needs a note explaining what to correct');
    }
    return this.decide(ctx, id, 'rejected', body);
  }

  @Post(':id/cancel')
  cancel(@TenantContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionBody) {
    return this.decide(ctx, id, 'cancelled', body);
  }

  private decide(ctx: RequestContext, id: string, status: ChangeRequestStatus, body: DecisionBody) {
    const note = typeof body.note === 'string' ? body.note.trim() : null;
    return withContext(
      this.db,
      ctx,
      async (trx) => {
        const row = await trx
          .updateTable('change_requests')
          .set({ status, decision_note: note })
          .where('id', '=', id)
          .returning(COLUMNS)
          .executeTakeFirst();
        if (!row) {
          throw new NotFoundException('change request not found');
        }
        return row;
      },
      { reason: note ?? undefined },
    );
  }
}
