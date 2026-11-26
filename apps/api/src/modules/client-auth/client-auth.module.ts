import { Global, Module } from '@nestjs/common';
import { ClientAuthGuard } from '../../common/auth/client-auth.guard';
import { OtpModule } from '../otp/otp.module';
import { ClientAuthController } from './client-auth.controller';
import { ClientAuthRepository } from './client-auth.repository';
import { ClientAuthService } from './client-auth.service';

// Global so any portal module can protect its routes with @ClientSignedIn() without importing this.
@Global()
@Module({
  imports: [OtpModule],
  controllers: [ClientAuthController],
  providers: [ClientAuthRepository, ClientAuthService, ClientAuthGuard],
  exports: [ClientAuthRepository, ClientAuthGuard],
})
export class ClientAuthModule {}
