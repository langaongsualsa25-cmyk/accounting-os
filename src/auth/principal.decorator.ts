import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest, Principal } from './jwt-auth.guard';
import { RequestContext } from '../database/request-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal!;
});

// Caller plus the company named in the X-Tenant-Id header.
export const TenantContext = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  const tenantId = req.headers['x-tenant-id'];
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) {
    throw new BadRequestException('X-Tenant-Id header must be a company id');
  }
  return { subject: req.principal!.subject, tenantId };
});
