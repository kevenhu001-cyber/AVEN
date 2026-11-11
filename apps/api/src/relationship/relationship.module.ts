import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RelationshipController } from './relationship.controller.js';
import { RelationshipService } from './relationship.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RelationshipController],
  providers: [RelationshipService],
  exports: [RelationshipService],
})
export class RelationshipModule {}
