import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LoginAttemptsRepository } from './login-attempts.repository';
import { LoginThrottleService } from './login-throttle.service';
import { RefreshSessionsService } from './refresh-sessions.service';
import { SessionsRepository } from './sessions.repository';
import { TrustedOriginGuard } from './trusted-origin.guard';

/**
 * What staff and client auth share: sessions, the login throttle and the origin check.
 * JwtModule has no default secret on purpose: every sign and verify passes the staff or client
 * secret explicitly, so a token can't be checked with the wrong one by accident.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [
    SessionsRepository,
    RefreshSessionsService,
    LoginAttemptsRepository,
    LoginThrottleService,
    TrustedOriginGuard,
  ],
  exports: [JwtModule, RefreshSessionsService, LoginThrottleService, TrustedOriginGuard],
})
export class AuthCoreModule {}
