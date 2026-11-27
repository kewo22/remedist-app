import { Injectable } from '@nestjs/common';
import {
  termsAcceptanceRequired,
  type PublishedTerms,
  type TermsConsentStatus,
  type TermsDraft,
  type TermsVersion,
} from '@remedist/shared';
import { AuditLogRepository } from '../../common/audit/audit-log.repository';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { DatabaseService, Queryable } from '../../database/database.service';
import { ContactAccessService } from '../contacts/contact-access.service';
import { ClientNotFoundException } from '../contacts/contacts.exceptions';
import { ContactsRepository, type ContactRow } from '../contacts/contacts.repository';
import { AcceptTermsDto, UpdateTermsDraftDto } from './dto/terms.dto';
import { TERMS_AUDIT_ACTION } from './terms.constants';
import {
  TermsIncompleteException,
  TermsNotPublishedException,
  TermsPublishConflictException,
  TermsVersionOutdatedException,
} from './terms.exceptions';
import { TermsRepository, type PublishedTermsRow, type TermsRow } from './terms.repository';

function toPublished(row: PublishedTermsRow): PublishedTerms {
  return {
    version: row.version_number,
    generalTermsContent: row.general_terms_content,
    refundPolicyContent: row.refund_policy_content,
    publishedAt: row.published_at.toISOString(),
  };
}

/**
 * Terms & Conditions (the old terms.service.js and its routes): one draft that staff edit, a
 * deliberate publish that freezes it as the next version, and each client's consent. Publishing
 * notifies nobody; clients accept the new version the next time they book (PRD B.2.3).
 */
@Injectable()
export class TermsService {
  constructor(
    private readonly terms: TermsRepository,
    private readonly contacts: ContactsRepository,
    private readonly access: ContactAccessService,
    private readonly audit: AuditLogRepository,
    private readonly db: DatabaseService,
  ) {}

  // ── Public ─────────────────────────────────────────────────────────────────────────────

  async current(): Promise<PublishedTerms> {
    const latest = await this.terms.latestPublished();
    if (!latest) {
      throw new TermsNotPublishedException();
    }
    return toPublished(latest);
  }

  /** The latest published version, or null before the first publish. */
  currentVersion(db?: Queryable): Promise<number | null> {
    return this.terms.latestVersionNumber(db);
  }

  /**
   * Throws TERMS_VERSION_OUTDATED unless `shown` is the latest published version (null when none
   * is published). For any step that records consent, so a client never accepts text they didn't see.
   */
  async requireShownIsCurrent(shown: number | null, db?: Queryable): Promise<number | null> {
    const current = await this.terms.latestVersionNumber(db);
    if (shown !== current) {
      throw new TermsVersionOutdatedException();
    }
    return current;
  }

  /** Whether the contact must accept the latest version before booking. For booking and walk-in. */
  async acceptanceRequired(contact: Pick<ContactRow, 'terms_accepted_version'>): Promise<boolean> {
    return termsAcceptanceRequired(contact.terms_accepted_version, await this.terms.latestVersionNumber());
  }

  // ── Portal ─────────────────────────────────────────────────────────────────────────────

  async consentStatus(client: CurrentClientAccount, contactId?: string): Promise<TermsConsentStatus> {
    const { contact } = await this.access.requireOwned(client, contactId);
    return this.statusFor(contact, await this.terms.latestVersionNumber());
  }

  /**
   * Re-consent for a returning client, kept apart from Part 1 so it never reopens the locked
   * fields. Accepting the version already accepted keeps the original time.
   */
  async accept(client: CurrentClientAccount, input: AcceptTermsDto, info: ClientInfo): Promise<TermsConsentStatus> {
    const { contact: owned } = await this.access.requireOwned(client, input.contactId);
    const current = await this.terms.latestVersionNumber();
    if (current === null) {
      throw new TermsNotPublishedException();
    }
    if (input.termsVersion !== current) {
      throw new TermsVersionOutdatedException();
    }

    await this.db.transaction(async (tx) => {
      const contact = await this.contacts.findByIdForUpdate(owned.id, tx);
      if (!contact) {
        throw new ClientNotFoundException();
      }
      if (contact.terms_accepted_version === current) {
        return;
      }
      await this.contacts.setTermsAccepted(contact.id, current, tx);
      await this.audit.record(
        {
          actorType: 'patient',
          actorId: client.id,
          actorLabel: client.email,
          action: TERMS_AUDIT_ACTION.accepted,
          entityType: 'contact',
          entityId: contact.id,
          before: { termsAcceptedVersion: contact.terms_accepted_version },
          after: { termsAcceptedVersion: current },
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
    return this.statusFor(updated, current);
  }

  // ── CRM ────────────────────────────────────────────────────────────────────────────────

  async draft(): Promise<TermsDraft> {
    const [draft, latest] = await Promise.all([this.ensureDraft(), this.terms.latestVersionNumber()]);
    return this.toDraft(draft, latest);
  }

  /** Saving a draft changes nothing clients see. */
  async updateDraft(input: UpdateTermsDraftDto, staff: CurrentStaff, info: ClientInfo): Promise<TermsDraft> {
    await this.ensureDraft();
    await this.db.transaction(async (tx) => {
      const draft = await this.terms.findDraftForUpdate(tx);
      if (!draft) {
        throw new TermsPublishConflictException();
      }
      if (
        draft.general_terms_content === input.generalTermsContent &&
        draft.refund_policy_content === input.refundPolicyContent
      ) {
        return;
      }
      await this.terms.updateDraft(draft.id, input.generalTermsContent, input.refundPolicyContent, tx);
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staff.id,
          actorLabel: staff.name,
          action: TERMS_AUDIT_ACTION.draftUpdated,
          entityType: 'terms_version',
          entityId: draft.id,
          after: {
            generalTermsLength: input.generalTermsContent.length,
            refundPolicyLength: input.refundPolicyContent.length,
          },
          requestId: info.requestId,
          ipAddress: info.ipAddress,
        },
        tx,
      );
    });
    return this.draft();
  }

  /**
   * Freezes the draft as the next version and starts a new draft from the same text, so the next
   * edit starts from what's live. Every client then has to accept it before their next booking.
   */
  async publish(staff: CurrentStaff, info: ClientInfo): Promise<TermsVersion> {
    await this.ensureDraft();
    const publishedId = await this.db.transaction(async (tx) => {
      const draft = await this.terms.findDraftForUpdate(tx);
      if (!draft) {
        throw new TermsPublishConflictException();
      }
      if (!draft.general_terms_content.trim() || !draft.refund_policy_content.trim()) {
        throw new TermsIncompleteException();
      }
      const version = ((await this.terms.latestVersionNumber(tx)) ?? 0) + 1;
      await this.terms.publish(draft.id, version, staff.id, tx);
      await this.terms.createDraftIfMissing(draft.general_terms_content, draft.refund_policy_content, tx);
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staff.id,
          actorLabel: staff.name,
          action: TERMS_AUDIT_ACTION.published,
          entityType: 'terms_version',
          entityId: draft.id,
          after: { version },
          requestId: info.requestId,
          ipAddress: info.ipAddress,
        },
        tx,
      );
      return draft.id;
    });
    const published = (await this.terms.listPublished()).find((row) => row.id === publishedId);
    if (!published) {
      throw new Error(`Published terms ${publishedId} not found`);
    }
    return { ...toPublished(published), publishedBy: published.published_by_name };
  }

  async history(): Promise<TermsVersion[]> {
    return (await this.terms.listPublished()).map((row) => ({ ...toPublished(row), publishedBy: row.published_by_name }));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────────────

  /** The seed creates the first draft and publishing always starts the next; this is a backstop. */
  private async ensureDraft(): Promise<TermsRow> {
    const existing = await this.terms.findDraft();
    if (existing) {
      return existing;
    }
    await this.terms.createDraftIfMissing('', '');
    const created = await this.terms.findDraft();
    if (!created) {
      throw new Error('Terms draft missing after create');
    }
    return created;
  }

  private toDraft(row: TermsRow, latest: number | null): TermsDraft {
    return {
      generalTermsContent: row.general_terms_content,
      refundPolicyContent: row.refund_policy_content,
      updatedAt: row.updated_at.toISOString(),
      nextVersion: (latest ?? 0) + 1,
    };
  }

  private statusFor(contact: ContactRow, current: number | null): TermsConsentStatus {
    return {
      contactId: contact.id,
      acceptedVersion: contact.terms_accepted_version,
      acceptedAt: contact.terms_accepted_at?.toISOString() ?? null,
      currentVersion: current,
      acceptanceRequired: termsAcceptanceRequired(contact.terms_accepted_version, current),
    };
  }
}
