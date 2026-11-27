import { Module } from '@nestjs/common';
import { OtpModule } from '../otp/otp.module';
import { TermsModule } from '../terms/terms.module';
import { AdminIntakeController, PortalIntakeController, PublicIntakeController } from './intake.controller';
import { IntakeFormsService } from './intake-forms.service';
import { IntakeRepository } from './intake.repository';
import { Part1Service } from './part1.service';

/**
 * Two-stage intake: Part 1 registration and Part 2, the per-visit health questionnaire with its
 * posture photos. Exports IntakeFormsService so booking and pro-bono can create the visit's form.
 */
@Module({
  imports: [OtpModule, TermsModule],
  controllers: [PublicIntakeController, PortalIntakeController, AdminIntakeController],
  providers: [IntakeRepository, Part1Service, IntakeFormsService],
  exports: [IntakeFormsService],
})
export class IntakeModule {}
