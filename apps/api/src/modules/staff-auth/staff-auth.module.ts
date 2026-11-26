import { Global, Module } from '@nestjs/common';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { StaffAuthGuard } from '../../common/auth/staff-auth.guard';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthRepository } from './staff-auth.repository';
import { StaffAuthService } from './staff-auth.service';

// Global so any feature module can protect its routes with @StaffOnly(...) without importing this.
@Global()
@Module({
  controllers: [StaffAuthController],
  providers: [StaffAuthRepository, StaffAuthService, StaffAuthGuard, PermissionsGuard],
  exports: [StaffAuthRepository, StaffAuthGuard, PermissionsGuard],
})
export class StaffAuthModule {}
