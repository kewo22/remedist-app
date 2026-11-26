import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AuditModule } from './common/audit/audit-log.repository';
import { AdminRoutePolicyGuard } from './common/auth/admin-route-policy.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { createGlobalValidationPipe } from './common/validation/global-validation.pipe';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { StaffAuthModule } from './modules/staff-auth/staff-auth.module';

@Module({
  imports: [ConfigModule, DatabaseModule, AuditModule, StaffAuthModule, HealthModule],
  providers: [
    // Registered here rather than in main.ts so they can use dependency injection.
    { provide: APP_PIPE, useFactory: createGlobalValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Every admin/... route must declare @StaffOnly, @StaffSignedIn or @PublicRoute.
    { provide: APP_GUARD, useClass: AdminRoutePolicyGuard },
  ],
})
export class AppModule {}
