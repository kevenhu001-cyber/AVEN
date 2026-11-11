import { Module } from '@nestjs/common';
import { ActionModule } from './action/action.module.js';
import { AgentModule } from './agent/agent.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthController } from './health.controller';
import { MemoryModule } from './memory/memory.module.js';
import { OpportunityModule } from './opportunity/opportunity.module.js';
import { OrganizationModule } from './organization/organization.module.js';
import { ProfileModule } from './profile/profile.module.js';

@Module({
  imports: [
    AuthModule,
    ProfileModule,
    OrganizationModule,
    OpportunityModule,
    MemoryModule,
    AgentModule,
    ActionModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
