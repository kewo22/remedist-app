import { Injectable } from '@nestjs/common';
import { residencyForNationality, type ApiFieldError, type ClientContactProfile } from '@remedist/shared';
import { AuditLogRepository } from '../../common/audit/audit-log.repository';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import { ValidationFailedException } from '../../common/exceptions/common.exceptions';
import { DatabaseService } from '../../database/database.service';
import { isUniqueViolation } from '../../database/pg-errors';
import { ContactAccessService } from '../contacts/contact-access.service';
import { ClientNotFoundException, EmailInUseException } from '../contacts/contacts.exceptions';
import { toClientProfile } from '../contacts/contacts.mapper';
import {
  CONTACT_EMAIL_INDEX,
  CONTACT_ID_NUMBER_INDEX,
  ContactsRepository,
  type ContactRow,
} from '../contacts/contacts.repository';
import { RegistrationNumberService } from '../contacts/registration-number.service';
import { PhoneVerificationService, type VerifiedPhone } from '../otp/phone-verification.service';
import { TermsService } from '../terms/terms.service';
import { CompletePart1Dto } from './dto/part1.dto';
import { INTAKE_AUDIT_ACTION, TOP_NATIONALITIES_LIMIT } from './intake.constants';
import { Part1AlreadyCompletedException, Part1DuplicateIdNumberException } from './intake.exceptions';

/**
 * Part 1 registration (the old POST /api/portal/intake/part1, PRD C.4.5): once per contact, for the
 * account holder or one of their dependents. It locks the identity fields, records consent to the
 * terms version shown and assigns the registration number, all in one transaction.
 */
@Injectable()
export class Part1Service {
  constructor(
    private readonly contacts: ContactsRepository,
    private readonly access: ContactAccessService,
    private readonly registrationNumbers: RegistrationNumberService,
    private readonly phoneVerification: PhoneVerificationService,
    private readonly terms: TermsService,
    private readonly audit: AuditLogRepository,
    private readonly db: DatabaseService,
  ) {}

  async topNationalities(): Promise<string[]> {
    return this.contacts.topNationalities(TOP_NATIONALITIES_LIMIT);
  }

  async complete(client: CurrentClientAccount, input: CompletePart1Dto, info: ClientInfo): Promise<ClientContactProfile> {
    const { contact: owned, isDependent } = await this.access.requireOwned(client, input.contactId);
    if (owned.part1_completed_at) {
      throw new Part1AlreadyCompletedException();
    }
    const idNumber = input.idNumber ?? null;
    this.checkFields(input, idNumber, owned, isDependent);
    await this.terms.requireShownIsCurrent(input.termsVersion);
    // A new mobile number receives sign-in and reset codes, so it must be proven first.
    const verifiedPhone: VerifiedPhone | undefined =
      typeof input.phone === 'string' && input.phone !== owned.phone
        ? await this.phoneVerification.check(input.phoneVerificationToken, 'phone_change', input.phone)
        : undefined;

    await this.db.transaction(async (tx) => {
      const contact = await this.contacts.findByIdForUpdate(owned.id, tx);
      if (!contact) {
        throw new ClientNotFoundException();
      }
      if (contact.part1_completed_at) {
        throw new Part1AlreadyCompletedException();
      }
      if (idNumber && (await this.contacts.idNumberTakenByAnother(idNumber, contact.id, tx))) {
        throw new Part1DuplicateIdNumberException();
      }
      // Dependents only: the account holder's email is their login (checkFields refused a change).
      const email = isDependent ? input.email : undefined;
      if (email && (await this.contacts.emailTakenByAnother(email, contact.id, tx))) {
        throw new EmailInUseException();
      }
      // Checked again under the lock, so a publish between the two checks can't slip through.
      const termsVersion = await this.terms.requireShownIsCurrent(input.termsVersion, tx);
      if (verifiedPhone) {
        await this.phoneVerification.useVerifiedPhone(verifiedPhone, 'phone_change', tx);
      }

      try {
        const completed = await this.contacts.completePart1(
          contact.id,
          {
            name: input.name,
            gender: input.gender,
            nationality: input.nationality,
            residency: residencyForNationality(input.nationality),
            id_type: idNumber ? input.idType : null,
            id_number: idNumber,
            date_of_birth: input.dateOfBirth,
            email,
            phone: input.phone,
            profession: input.profession ?? null,
            address: input.address ?? null,
            backup_contact_name: input.backupContactName ?? null,
            backup_contact_relation: input.backupContactRelation ?? null,
            backup_contact_phone: input.backupContactPhone ?? null,
            referral_text: input.referralText ?? null,
            terms_accepted_version: termsVersion,
          },
          tx,
        );
        if (!completed) {
          throw new Part1AlreadyCompletedException();
        }
      } catch (error) {
        // Backstops for two registrations racing on the same ID number or email.
        if (isUniqueViolation(error, CONTACT_ID_NUMBER_INDEX)) {
          throw new Part1DuplicateIdNumberException(error);
        }
        if (isUniqueViolation(error, CONTACT_EMAIL_INDEX)) {
          throw new EmailInUseException(error);
        }
        throw error;
      }

      const assigned = await this.registrationNumbers.assign(contact.id, tx);
      await this.audit.record(
        {
          actorType: 'patient',
          actorId: client.id,
          actorLabel: client.email,
          action: INTAKE_AUDIT_ACTION.part1Completed,
          entityType: 'contact',
          entityId: contact.id,
          after: {
            registrationNumber: assigned,
            dependent: isDependent,
            nationality: input.nationality,
            termsAcceptedVersion: termsVersion,
            phoneVerified: verifiedPhone !== undefined,
          },
          requestId: info.requestId,
          ipAddress: info.ipAddress,
        },
        tx,
      );
    });

    const updated = await this.contacts.findById(owned.id);
    if (!updated) {
      throw new ClientNotFoundException();
    }
    return toClientProfile(updated, isDependent);
  }

  /** The cross-field rules a DTO can't express, reported per field like the ValidationPipe. */
  private checkFields(input: CompletePart1Dto, idNumber: string | null, owned: ContactRow, isDependent: boolean): void {
    const errors: ApiFieldError[] = [];
    if (input.dateOfBirth > new Date().toISOString().slice(0, 10)) {
      errors.push({ field: 'dateOfBirth', messages: ['The date of birth can’t be in the future'] });
    }
    // NIC/passport is optional only for dependents (PRD C.4.4); type and number go together.
    if ((input.idType === null) !== (idNumber === null)) {
      errors.push({ field: 'idNumber', messages: ['Give both the ID type and number, or neither'] });
    } else if (idNumber === null && !isDependent) {
      errors.push({ field: 'idNumber', messages: ['Enter your NIC or passport number'] });
    }
    if (!isDependent && input.email !== undefined && input.email !== owned.email) {
      errors.push({ field: 'email', messages: ['Your email is how you sign in, so it can’t be changed here'] });
    }
    if (errors.length > 0) {
      throw new ValidationFailedException(errors);
    }
  }
}
