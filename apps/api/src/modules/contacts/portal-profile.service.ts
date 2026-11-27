import { Injectable } from '@nestjs/common';
import type { ClientContactProfile, DependentSummary } from '@remedist/shared';
import { AuditLogRepository } from '../../common/audit/audit-log.repository';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import { DatabaseService } from '../../database/database.service';
import { PhoneVerificationService } from '../otp/phone-verification.service';
import { ContactAccessService } from './contact-access.service';
import { contactChanges } from './contact-changes';
import { AUDIT_ACTION } from './contacts.constants';
import { ClientNotFoundException, Part1IncompleteException } from './contacts.exceptions';
import { toClientProfile, toDependentSummary } from './contacts.mapper';
import { ContactsRepository } from './contacts.repository';
import { CreateDependentDto, UpdateClientProfileDto } from './dto/portal-profile.dto';

/**
 * The client's own profile and dependents in the portal (the old /api/portal/me, /profile and
 * /dependents). The identity fields are locked after Part 1; the rest stay editable, except the
 * email, which is also the login and changes through its own flow.
 */
@Injectable()
export class PortalProfileService {
  constructor(
    private readonly contacts: ContactsRepository,
    private readonly access: ContactAccessService,
    private readonly phoneVerification: PhoneVerificationService,
    private readonly audit: AuditLogRepository,
    private readonly db: DatabaseService,
  ) {}

  async profile(client: CurrentClientAccount, contactId?: string): Promise<ClientContactProfile> {
    const { contact, isDependent } = await this.access.requireOwned(client, contactId);
    return toClientProfile(contact, isDependent);
  }

  /**
   * Updates the editable fields. A new mobile number needs a 'phone_change' proof for that number,
   * spent in the same transaction: the number receives sign-in and password reset codes.
   */
  async updateProfile(client: CurrentClientAccount, input: UpdateClientProfileDto, info: ClientInfo): Promise<ClientContactProfile> {
    const { contact: owned, isDependent } = await this.access.requireOwned(client, input.contactId);
    if (!owned.part1_completed_at) {
      throw new Part1IncompleteException();
    }
    const verifiedPhone =
      typeof input.phone === 'string' && input.phone !== owned.phone
        ? await this.phoneVerification.check(input.phoneVerificationToken, 'phone_change', input.phone)
        : undefined;

    await this.db.transaction(async (tx) => {
      const current = await this.contacts.findByIdForUpdate(owned.id, tx);
      if (!current) {
        throw new ClientNotFoundException();
      }
      if (!current.part1_completed_at) {
        throw new Part1IncompleteException();
      }
      const changes = contactChanges(current, {
        phone: input.phone,
        profession: input.profession,
        address: input.address,
        backup_contact_name: input.backupContactName,
        backup_contact_relation: input.backupContactRelation,
        backup_contact_phone: input.backupContactPhone,
      });
      if (!changes.changed) {
        return;
      }
      if (verifiedPhone && changes.update.phone !== undefined) {
        await this.phoneVerification.useVerifiedPhone(verifiedPhone, 'phone_change', tx);
      }
      await this.contacts.update(current.id, changes.update, tx);
      await this.audit.record(
        {
          actorType: 'patient',
          actorId: client.id,
          actorLabel: client.email,
          action: AUDIT_ACTION.profileUpdated,
          entityType: 'contact',
          entityId: current.id,
          before: changes.before,
          after: changes.after,
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

  async dependents(client: CurrentClientAccount): Promise<DependentSummary[]> {
    return (await this.contacts.listDependents(client.id)).map(toDependentSummary);
  }

  /** A bare profile; the client completes Part 1 for it next. */
  async addDependent(client: CurrentClientAccount, input: CreateDependentDto, info: ClientInfo): Promise<DependentSummary> {
    const created = await this.db.transaction(async (tx) => {
      const dependent = await this.contacts.createDependent(client.id, input, tx);
      await this.audit.record(
        {
          actorType: 'patient',
          actorId: client.id,
          actorLabel: client.email,
          action: AUDIT_ACTION.dependentAdded,
          entityType: 'contact',
          entityId: dependent.id,
          after: { name: dependent.name, relationship: dependent.relationship },
          requestId: info.requestId,
          ipAddress: info.ipAddress,
        },
        tx,
      );
      return dependent;
    });
    return toDependentSummary(created);
  }
}
