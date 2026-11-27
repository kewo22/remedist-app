import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './common/audit/audit-log.repository';
import { AuthCoreModule } from './common/auth/auth-core.module';
import { RoutePolicyGuard } from './common/auth/route-policy.guard';
import { ClinicalAccessLogModule } from './common/clinical/clinical-access-log.repository';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { createGlobalValidationPipe } from './common/validation/global-validation.pipe';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { ClientAuthModule } from './modules/client-auth/client-auth.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { HealthModule } from './modules/health/health.module';
import { IntakeModule } from './modules/intake/intake.module';
import { NotificationsModule } from './modules/notifications/notifications.service';
import { OtpModule } from './modules/otp/otp.module';
import { StaffAuthModule } from './modules/staff-auth/staff-auth.module';
import { TermsModule } from './modules/terms/terms.module';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuditModule,
    ClinicalAccessLogModule,
    IntegrationsModule,
    NotificationsModule,
    ContactsModule,
    AuthCoreModule,
    StaffAuthModule,
    ClientAuthModule,
    OtpModule,
    AvailabilityModule,
    CalendarModule,
    TermsModule,
    IntakeModule,
    HealthModule,
  ],
  providers: [
    // Registered here rather than in main.ts so they can use dependency injection.
    { provide: APP_PIPE, useFactory: createGlobalValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Every admin/... and portal/... route must declare who may call it.
    { provide: APP_GUARD, useClass: RoutePolicyGuard },
  ],
})
export class AppModule {}
