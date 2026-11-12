import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ConnectionController } from './connection.controller.js';
import { ConnectionService } from './connection.service.js';
@Module({
  imports: [AuthModule],
  controllers: [ConnectionController],
  providers: [ConnectionService],
})
export class ConnectionModule {}
