import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReferralController } from './referral.controller.js';
import { ReferralService } from './referral.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
