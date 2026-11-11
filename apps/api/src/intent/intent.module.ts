import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IntentController } from './intent.controller.js';
import { IntentService } from './intent.service.js';

@Module({
  imports: [AuthModule],
  controllers: [IntentController],
  providers: [IntentService],
  exports: [IntentService],
})
export class IntentModule {}
