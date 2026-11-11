import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MemoryController } from './memory.controller.js';
import { MemoryService } from './memory.service.js';

@Module({
  imports: [AuthModule],
  controllers: [MemoryController],
  providers: [MemoryService],
})
export class MemoryModule {}
