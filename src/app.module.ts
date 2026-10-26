import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { IdentityController } from './identity/identity.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, IdentityController],
})
export class AppModule {}
