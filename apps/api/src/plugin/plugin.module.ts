import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PluginController } from './plugin.controller.js';
import { PluginService } from './plugin.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PluginController],
  providers: [PluginService],
  exports: [PluginService],
})
export class PluginModule {}
