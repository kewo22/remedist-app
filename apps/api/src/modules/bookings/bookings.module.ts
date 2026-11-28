import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { CalendarModule } from '../calendar/calendar.module';
import { IntakeModule } from '../intake/intake.module';
import { TermsModule } from '../terms/terms.module';
import { BookingChangesService } from './booking-changes.service';
import { BookingCoreService } from './booking-core.service';
import { BookingCreationService } from './booking-creation.service';
import { BookingQueriesService } from './booking-queries.service';
import { AdminBookingsController, PortalBookingsController } from './bookings.controller';
import { BookingsRepository } from './bookings.repository';
import { HoldReleaseJob } from './hold-release.job';

/**
 * Appointments: booking and checkout holds, staff bookings, reschedules, cancellations, no-shows
 * with strikes, the walk-in kiosk and staff notes. Exports the core for pro-bono session assignment.
 */
@Module({
  imports: [AvailabilityModule, CalendarModule, IntakeModule, TermsModule],
  controllers: [PortalBookingsController, AdminBookingsController],
  providers: [BookingsRepository, BookingCoreService, BookingCreationService, BookingChangesService, BookingQueriesService, HoldReleaseJob],
  exports: [BookingCoreService, BookingsRepository],
})
export class BookingsModule {}
