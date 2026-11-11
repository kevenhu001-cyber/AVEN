import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { HealthController } from './health.controller';
import { MemoryModule } from './memory/memory.module.js';
import { OrganizationModule } from './organization/organization.module.js';
import { ProfileModule } from './profile/profile.module.js';

@Module({
  imports: [AuthModule, ProfileModule, OrganizationModule, MemoryModule],
  controllers: [HealthController],
})
export class AppModule {}
