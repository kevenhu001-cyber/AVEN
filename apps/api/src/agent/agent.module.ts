import { Module } from '@nestjs/common';
import { UserAIProviderController } from '../ai-provider/provider.controller.js';
import { UserAIProviderService } from '../ai-provider/provider.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AgentController } from './agent.controller.js';
import { AgentService } from './agent.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AgentController, UserAIProviderController],
  providers: [AgentService, UserAIProviderService],
})
export class AgentModule {}
