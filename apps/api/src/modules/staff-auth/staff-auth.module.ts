import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { StaffAuthGuard } from '../../common/auth/staff-auth.guard';
import { AppConfig } from '../../config/app-config';
import { LoginThrottleService } from './login-throttle.service';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthRepository } from './staff-auth.repository';
import { StaffAuthService } from './staff-auth.service';
import { TrustedOriginGuard } from './trusted-origin.guard';

// Global so any feature module can protect its routes with @StaffOnly(...) without importing this.
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({ secret: config.auth.staffJwtSecret }),
    }),
  ],
  controllers: [StaffAuthController],
  providers: [
    StaffAuthRepository,
    StaffAuthService,
    LoginThrottleService,
    StaffAuthGuard,
    PermissionsGuard,
    TrustedOriginGuard,
  ],
  exports: [JwtModule, StaffAuthRepository, StaffAuthGuard, PermissionsGuard],
})
export class StaffAuthModule {}
