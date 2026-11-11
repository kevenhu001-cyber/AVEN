import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { HealthController } from './health.controller';
import { ProfileModule } from './profile/profile.module.js';

@Module({ imports: [AuthModule, ProfileModule], controllers: [HealthController] })
export class AppModule {}
