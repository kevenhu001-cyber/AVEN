import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AgentController } from './agent.controller.js';
import { AgentService } from './agent.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
