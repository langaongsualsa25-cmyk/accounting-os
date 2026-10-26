import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditController } from './control/audit.controller';
import { ChangeRequestsController } from './control/change-requests.controller';
import { DatabaseModule } from './database/database.module';
import { PgErrorFilter } from './database/pg-error.filter';
import { HealthController } from './health/health.controller';
import { IdentityController } from './identity/identity.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, IdentityController, ChangeRequestsController, AuditController],
  providers: [{ provide: APP_FILTER, useClass: PgErrorFilter }],
})
export class AppModule {}
