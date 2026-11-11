import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ActionController } from './action.controller.js';
import { ActionService } from './action.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ActionController],
  providers: [ActionService],
})
export class ActionModule {}
