import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AvailabilityModule } from '../availability/availability.module.js';
import { EventCoordinationService } from './event-coordination.service.js';
import { EventController } from './event.controller.js';
import { EventService } from './event.service.js';

@Module({
  imports: [AuthModule, AvailabilityModule],
  controllers: [EventController],
  providers: [EventService, EventCoordinationService],
  exports: [EventService, EventCoordinationService],
})
export class EventModule {}
