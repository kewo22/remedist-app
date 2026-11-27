import { Injectable } from '@nestjs/common';
import {
  residencyForNationality,
  type ClientDetail,
  type ClientListItem,
  type ClientListMeta,
  type ClientLookupItem,
  type IdentityCorrection,
} from '@remedist/shared';
import { AuditLogRepository } from '../../common/audit/audit-log.repository';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ValidationFailedException } from '../../common/exceptions/common.exceptions';
import { WithMeta } from '../../common/responses/with-meta';
import { DatabaseService, Queryable } from '../../database/database.service';
import { isUniqueViolation } from '../../database/pg-errors';
import { ContactChanges, contactChanges } from './contact-changes';
import {
  AUDIT_ACTION,
  CLIENT_LIST_DEFAULT_PAGE_SIZE,
  CLIENT_LOOKUP_LIMIT,
  IDENTITY_CORRECTIONS_LIMIT,
  REFERRAL_MIN_WORD_LENGTH,
  REFERRAL_STOPWORDS,
} from './contacts.constants';
import {
  ClientNotFoundException,
  ContactEmailLockedException,
  DuplicateIdNumberException,
  EmailInUseException,
} from './contacts.exceptions';
import { toListItem, toLookup } from './contacts.mapper';
import {
  CONTACT_EMAIL_INDEX,
  CONTACT_ID_NUMBER_INDEX,
  ContactLookupRow,
  ContactRow,
  ContactsRepository,
  ContactUpdate,
} from './contacts.repository';
import {
  ClientListQueryDto,
  CorrectIdentityDto,
  StaffUpdateClientDto,
  UpdatePaymentSettingsDto,
  UpdateReferralDto,
} from './dto/admin-clients.dto';

/**
 * The CRM side of contacts: the client list and search, the client detail, and staff edits. Every
 * edit locks the row, records only the fields that actually changed in audit_log, and answers
 * with the fresh detail.
 */
@Injectable()
export class AdminClientsService {
  constructor(
    private readonly contacts: ContactsRepository,
    private readonly audit: AuditLogRepository,
    private readonly db: DatabaseService,
  ) {}

  // ── Reading ──────────────────────────────────────────────────────────────────────────────

  async list(query: ClientListQueryDto): Promise<WithMeta<ClientListItem[], ClientListMeta & Record<string, unknown>>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? CLIENT_LIST_DEFAULT_PAGE_SIZE;
    const { rows, total } = await this.contacts.list({
      q: query.q,
      stage: query.stage,
      includeArchived: query.includeArchived ?? false,
      sortBy: query.sortBy ?? 'updatedAt',
      sortDir: query.sortDir ?? 'desc',
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return new WithMeta(rows.map(toListItem), { page, pageSize, total });
  }

  async lookup(q: string): Promise<ClientLookupItem[]> {
    return (await this.contacts.lookup(q, CLIENT_LOOKUP_LIMIT)).map(toLookup);
  }

  async detail(id: string): Promise<ClientDetail> {
    const contact = await this.contacts.findById(id);
    if (!contact) {
      throw new ClientNotFoundException();
    }
    const [account, managedBy, dependents, strikeCount, corrections, referredBy, suggestedReferral] = await Promise.all([
      this.contacts.accountSummary(id),
      this.contacts.managedBy(id),
      this.contacts.dependentsOfContact(id),
      this.contacts.strikeCount(id),
      this.contacts.identityCorrections(id, AUDIT_ACTION.identityCorrected, IDENTITY_CORRECTIONS_LIMIT),
      contact.referred_by_contact_id ? this.contacts.findLookup(contact.referred_by_contact_id) : undefined,
      contact.referred_by_contact_id ? undefined : this.suggestReferral(contact),
    ]);

    return {
      id: contact.id,
      registrationNumber: contact.registration_number,
      stage: contact.stage,
      source: contact.source,
      part1CompletedAt: contact.part1_completed_at?.toISOString() ?? null,
      archivedAt: contact.archived_at?.toISOString() ?? null,
      createdAt: contact.created_at.toISOString(),
      updatedAt: contact.updated_at.toISOString(),
      name: contact.name,
      gender: contact.gender,
      nationality: contact.nationality,
      residency: contact.residency,
      idType: contact.id_type,
      idNumber: contact.id_number,
      dateOfBirth: contact.date_of_birth,
      email: contact.email,
      phone: contact.phone,
      profession: contact.profession,
      address: contact.address,
      backupContactName: contact.backup_contact_name,
      backupContactRelation: contact.backup_contact_relation,
      backupContactPhone: contact.backup_contact_phone,
      referralText: contact.referral_text,
      referredBy: referredBy ? toLookup(referredBy) : null,
      suggestedReferral: suggestedReferral ? toLookup(suggestedReferral) : null,
      payAfterSession: contact.pay_after_session,
      reminderFrequencyDays: contact.reminder_frequency_days,
      termsAcceptedAt: contact.terms_accepted_at?.toISOString() ?? null,
      termsAcceptedVersion: contact.terms_accepted_version,
      account: account
        ? {
            email: account.email,
            authProvider: account.auth_provider,
            emailVerified: account.email_verified_at !== null,
            lastLoginAt: account.last_login_at?.toISOString() ?? null,
            createdAt: account.created_at.toISOString(),
          }
        : null,
      managedBy: managedBy ? toLookup(managedBy) : null,
      dependents: dependents.map((row) => ({ ...toLookup(row), relationship: row.relationship })),
      strikeCount,
      identityCorrections: corrections.map(
        (row): IdentityCorrection => ({
          changedAt: row.created_at.toISOString(),
          changedBy: row.actor_label,
          before: row.before ?? {},
          after: row.after ?? {},
          note: row.note,
        }),
      ),
    };
  }

  // ── Staff edits ──────────────────────────────────────────────────────────────────────────

  /**
   * The editable details and the pipeline stage. The name only until Part 1 locks it. The email
   * can't change while the contact has a portal login (it's their sign-in address).
   */
  async update(id: string, input: StaffUpdateClientDto, staff: CurrentStaff, info: ClientInfo): Promise<ClientDetail> {
    await this.edit(id, staff, info, AUDIT_ACTION.updated, async (current, tx) => {
      if (input.name !== undefined && input.name !== current.name && current.part1_completed_at) {
        throw new ValidationFailedException([
          { field: 'name', messages: ['The name is locked after registration. Correct it as an identity change.'] },
        ]);
      }
      const changes = contactChanges(current, {
        name: input.name,
        email: input.email,
        phone: input.phone,
        profession: input.profession,
        address: input.address,
        backup_contact_name: input.backupContactName,
        backup_contact_relation: input.backupContactRelation,
        backup_contact_phone: input.backupContactPhone,
        stage: input.stage,
      });
      const newEmail = changes.update.email;
      if (newEmail !== undefined) {
        if (await this.contacts.hasAccount(id, tx)) {
          throw new ContactEmailLockedException();
        }
        if (newEmail !== null && (await this.contacts.emailTakenByAnother(newEmail, id, tx))) {
          throw new EmailInUseException();
        }
      }
      return { changes };
    });
    return this.detail(id);
  }

  /**
   * Corrects the locked Part 1 fields (owners only). ID type and number are set or cleared
   * together; a nationality change moves residency with it, so the booking currency follows.
   */
  async correctIdentity(id: string, input: CorrectIdentityDto, staff: CurrentStaff, info: ClientInfo): Promise<ClientDetail> {
    const given = [input.name, input.gender, input.nationality, input.idType, input.idNumber, input.dateOfBirth];
    if (given.every((value) => value === undefined)) {
      throw new ValidationFailedException([{ field: 'name', messages: ['Give at least one field to correct'] }]);
    }
    if (input.dateOfBirth !== undefined && input.dateOfBirth > new Date().toISOString().slice(0, 10)) {
      throw new ValidationFailedException([{ field: 'dateOfBirth', messages: ['The date of birth can’t be in the future'] }]);
    }

    await this.edit(id, staff, info, AUDIT_ACTION.identityCorrected, async (current, tx) => {
      const idType = input.idType === undefined ? current.id_type : input.idType;
      const idNumber = input.idNumber === undefined ? current.id_number : input.idNumber;
      if ((idType === null) !== (idNumber === null)) {
        throw new ValidationFailedException([
          { field: 'idNumber', messages: ['Give both the ID type and number, or clear both'] },
        ]);
      }
      const requested: ContactUpdate = {
        name: input.name,
        gender: input.gender,
        nationality: input.nationality,
        id_type: input.idType,
        id_number: input.idNumber,
        date_of_birth: input.dateOfBirth,
      };
      if (input.nationality !== undefined) {
        requested.residency = residencyForNationality(input.nationality);
      }
      const changes = contactChanges(current, requested);
      if (changes.update.id_number && (await this.contacts.idNumberTakenByAnother(changes.update.id_number, id, tx))) {
        throw new DuplicateIdNumberException();
      }
      return { changes, note: input.note };
    });
    return this.detail(id);
  }

  /** Who referred this client, from the picker or the suggestion. Null clears it. */
  async setReferral(id: string, input: UpdateReferralDto, staff: CurrentStaff, info: ClientInfo): Promise<ClientDetail> {
    const referrerId = input.referredByContactId;
    if (referrerId === id) {
      throw new ValidationFailedException([{ field: 'referredByContactId', messages: ['A client can’t refer themselves'] }]);
    }
    await this.edit(id, staff, info, AUDIT_ACTION.referralChanged, async (current, tx) => {
      if (referrerId !== null && !(await this.contacts.findLookup(referrerId, tx))) {
        throw new ValidationFailedException([{ field: 'referredByContactId', messages: ['That client doesn’t exist'] }]);
      }
      return { changes: contactChanges(current, { referred_by_contact_id: referrerId }) };
    });
    return this.detail(id);
  }

  /** The pay-after-session switch and reminder cadence. Credit isn't editable: it comes from payments. */
  async setPaymentSettings(
    id: string,
    input: UpdatePaymentSettingsDto,
    staff: CurrentStaff,
    info: ClientInfo,
  ): Promise<ClientDetail> {
    if (input.payAfterSession === undefined && input.reminderFrequencyDays === undefined) {
      throw new ValidationFailedException([{ field: 'payAfterSession', messages: ['Give at least one setting to change'] }]);
    }
    await this.edit(id, staff, info, AUDIT_ACTION.paymentSettingsChanged, async (current) => ({
      changes: contactChanges(current, {
        pay_after_session: input.payAfterSession,
        reminder_frequency_days: input.reminderFrequencyDays,
      }),
    }));
    return this.detail(id);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────────────────

  /**
   * One staff edit: lock the contact, work out the changes, write them and the audit entry in one
   * transaction. Nothing is written (or audited) when nothing changes. The unique indexes back up
   * the email and ID number pre-checks against a concurrent edit.
   */
  private async edit(
    id: string,
    staff: CurrentStaff,
    info: ClientInfo,
    action: string,
    decide: (current: ContactRow, tx: Queryable) => Promise<{ changes: ContactChanges; note?: string }>,
  ): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const current = await this.contacts.findByIdForUpdate(id, tx);
        if (!current) {
          throw new ClientNotFoundException();
        }
        const { changes, note } = await decide(current, tx);
        if (!changes.changed) {
          return;
        }
        await this.contacts.update(id, changes.update, tx);
        await this.audit.record(
          {
            actorType: 'staff',
            actorId: staff.id,
            actorLabel: staff.name,
            action,
            entityType: 'contact',
            entityId: id,
            before: changes.before,
            after: changes.after,
            note,
            requestId: info.requestId,
            ipAddress: info.ipAddress,
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, CONTACT_EMAIL_INDEX)) {
        throw new EmailInUseException(error);
      }
      if (isUniqueViolation(error, CONTACT_ID_NUMBER_INDEX)) {
        throw new DuplicateIdNumberException(error);
      }
      throw error;
    }
  }

  /**
   * A best guess at the referrer from "how did you hear about us", as the old app: drop filler
   * and relationship words, then pick the contact whose name matches the most remaining words.
   * Imperfect on purpose; staff confirm or pick someone else.
   */
  private async suggestReferral(contact: ContactRow): Promise<ContactLookupRow | undefined> {
    if (!contact.referral_text) {
      return undefined;
    }
    const words = contact.referral_text
      .split(/[^a-zA-Z]+/)
      .filter((word) => word.length >= REFERRAL_MIN_WORD_LENGTH && !REFERRAL_STOPWORDS.has(word.toLowerCase()));
    if (words.length === 0) {
      return undefined;
    }
    const [best] = await this.contacts.matchNameWords([...new Set(words)], contact.id, 1);
    return best;
  }
}
