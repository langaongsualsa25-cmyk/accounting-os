import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { JwtAuthGuard, Principal } from '../auth/jwt-auth.guard';
import { CurrentPrincipal, TenantContext } from '../auth/principal.decorator';
import { DB } from '../database/database.module';
import { hasPermission, RequestContext, withContext } from '../database/request-context';
import { Database } from '../database/schema';

interface CreateDepartmentBody {
  code?: unknown;
  name?: unknown;
}

// Blueprint §3: users, companies (tenants) and departments.
@Controller()
@UseGuards(JwtAuthGuard)
export class IdentityController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  // Companies the caller may act in, with the caller's role in each.
  @Get('me/tenants')
  myTenants(@CurrentPrincipal() principal: Principal) {
    return withContext(this.db, { subject: principal.subject }, (trx) =>
      trx
        .selectFrom(
          sql<{ tenant_id: string; code: string; name: string; role_id: string }>`app.my_memberships()`.as('m'),
        )
        .select(['m.tenant_id as id', 'm.code', 'm.name', 'm.role_id as role'])
        .orderBy('m.code')
        .execute(),
    );
  }

  @Get('departments')
  listDepartments(@TenantContext() ctx: RequestContext) {
    return withContext(this.db, ctx, (trx) =>
      trx.selectFrom('departments').select(['id', 'code', 'name']).orderBy('code').execute(),
    );
  }

  @Post('departments')
  createDepartment(@TenantContext() ctx: RequestContext, @Body() body: CreateDepartmentBody) {
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!code || !name) {
      throw new BadRequestException('code and name are required');
    }
    return withContext(this.db, ctx, async (trx) => {
      if (!(await hasPermission(trx, 'department.manage'))) {
        throw new ForbiddenException('Missing permission department.manage');
      }
      return trx
        .insertInto('departments')
        .values({ tenant_id: ctx.tenantId!, code, name })
        .returning(['id', 'code', 'name'])
        .executeTakeFirstOrThrow();
    });
  }
}
