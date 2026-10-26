import { ForbiddenException } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import { Database } from './schema';

export interface RequestContext {
  // Verified identity-provider subject of the caller.
  subject: string;
  // Tenant the request acts in; omitted for tenant-independent calls.
  tenantId?: string;
}

// Runs fn in one transaction whose Row-Level Security context is the caller.
// `set_config(..., true)` is transaction-local, so the context cannot leak to
// another request through a pooled connection (PgBouncer transaction mode).
export async function withContext<T>(
  db: Kysely<Database>,
  ctx: RequestContext,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.subject', ${ctx.subject}, true),
                     set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true)`.execute(trx);
    if (ctx.tenantId) {
      const { rows } = await sql<{ tenant_id: string | null }>`select app.current_tenant_id() as tenant_id`.execute(trx);
      if (rows[0]?.tenant_id !== ctx.tenantId) {
        throw new ForbiddenException('No access to this company');
      }
    }
    return fn(trx);
  });
}

// True when the caller holds the permission in the current tenant.
export async function hasPermission(trx: Transaction<Database>, permission: string): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`select app.has_permission(${permission}) as ok`.execute(trx);
  return rows[0]?.ok === true;
}
