import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { HealthController } from './health.controller';
import { OrganizationModule } from './organization/organization.module.js';
import { ProfileModule } from './profile/profile.module.js';

@Module({
  imports: [AuthModule, ProfileModule, OrganizationModule],
  controllers: [HealthController],
})
export class AppModule {}
