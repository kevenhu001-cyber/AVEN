import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventController } from './event.controller.js';
import { EventService } from './event.service.js';

@Module({
  imports: [AuthModule],
  controllers: [EventController],
  providers: [EventService],
  exports: [EventService],
})
export class EventModule {}
