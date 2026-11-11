import { Module } from '@nestjs/common';
import { ActionModule } from './action/action.module.js';
import { AgentModule } from './agent/agent.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AvailabilityModule } from './availability/availability.module.js';
import { EventModule } from './event/event.module.js';
import { HealthController } from './health.controller';
import { IntentModule } from './intent/intent.module.js';
import { MemoryModule } from './memory/memory.module.js';
import { OpportunityModule } from './opportunity/opportunity.module.js';
import { OrganizationModule } from './organization/organization.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { ReferralModule } from './referral/referral.module.js';
import { RelationshipModule } from './relationship/relationship.module.js';

@Module({
  imports: [
    AuthModule,
    ProfileModule,
    OrganizationModule,
    OpportunityModule,
    MemoryModule,
    AgentModule,
    ActionModule,
    IntentModule,
    ReferralModule,
    RelationshipModule,
    AvailabilityModule,
    EventModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
