import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OpportunityController } from './opportunity.controller.js';
import { OpportunityService } from './opportunity.service.js';

@Module({
  imports: [AuthModule],
  controllers: [OpportunityController],
  providers: [OpportunityService],
  exports: [OpportunityService],
})
export class OpportunityModule {}
