import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { EmailProvider, createEmailProvider } from './email/email.provider';
import { GoogleCalendarApi, createGoogleCalendarApi } from './google/google-calendar.api';
import { GoogleIdentityVerifier, createGoogleIdentityVerifier } from './google/google-identity.verifier';
import { PhoneMessenger, createPhoneMessenger } from './messaging/phone-messenger';
import { FileStorage, createFileStorage } from './storage/file-storage';
import { TurnstileVerifier, createTurnstileVerifier } from './turnstile/turnstile.verifier';

/**
 * Third-party services. Each is injected by its abstract class; the factory picks the real
 * implementation, or the demo one (with a startup warning) when its settings are missing.
 */
@Global()
@Module({
  providers: [
    { provide: EmailProvider, inject: [AppConfig], useFactory: createEmailProvider },
    { provide: TurnstileVerifier, inject: [AppConfig], useFactory: createTurnstileVerifier },
    { provide: GoogleIdentityVerifier, inject: [AppConfig], useFactory: createGoogleIdentityVerifier },
    { provide: PhoneMessenger, inject: [AppConfig], useFactory: createPhoneMessenger },
    { provide: GoogleCalendarApi, inject: [AppConfig], useFactory: createGoogleCalendarApi },
    { provide: FileStorage, inject: [AppConfig], useFactory: createFileStorage },
  ],
  exports: [EmailProvider, TurnstileVerifier, GoogleIdentityVerifier, GoogleCalendarApi, PhoneMessenger, FileStorage],
})
export class IntegrationsModule {}
