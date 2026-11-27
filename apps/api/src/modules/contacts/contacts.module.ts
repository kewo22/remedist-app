import { Global, Module } from '@nestjs/common';
import { OtpModule } from '../otp/otp.module';
import { AdminClientsController } from './admin-clients.controller';
import { AdminClientsService } from './admin-clients.service';
import { ContactAccessService } from './contact-access.service';
import { ContactsRepository } from './contacts.repository';
import { PortalProfileController } from './portal-profile.controller';
import { PortalProfileService } from './portal-profile.service';
import { RegistrationNumberService } from './registration-number.service';

/**
 * Contacts: the client's own profile and dependents, the CRM client list and detail, staff edits
 * and registration numbers. Global because sign-up, intake, booking and pro-bono all need the
 * repository, the ownership check and the registration number.
 */
@Global()
@Module({
  imports: [OtpModule],
  controllers: [PortalProfileController, AdminClientsController],
  providers: [ContactsRepository, ContactAccessService, RegistrationNumberService, PortalProfileService, AdminClientsService],
  exports: [ContactsRepository, ContactAccessService, RegistrationNumberService],
})
export class ContactsModule {}
