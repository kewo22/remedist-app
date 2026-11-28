import { Injectable } from '@nestjs/common';
import type {
  AnatomySegment,
  ApiFieldError,
  IntakeAnswers,
  IntakeCompletedVia,
  IntakeForm,
  IntakeFormSummary,
  IntakePainPointInput,
  IntakePhoto,
  IntakePhotoContentType,
  IntakePrefill,
  PosturePhotoSide,
} from '@remedist/shared';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository, type AuditEntry } from '../../common/audit/audit-log.repository';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ClinicalAccessLogRepository } from '../../common/clinical/clinical-access-log.repository';
import { ServiceUnavailableDomainException, ValidationFailedException } from '../../common/exceptions/common.exceptions';
import { DatabaseService, Queryable } from '../../database/database.service';
import { FileStorage, StoredFileNotFoundError, type StoredFile } from '../../integrations/storage/file-storage';
import { ContactAccessService } from '../contacts/contact-access.service';
import { ClientNotFoundException } from '../contacts/contacts.exceptions';
import { ContactsRepository } from '../contacts/contacts.repository';
import { SubmitIntakeDto } from './dto/intake.dto';
import { parseIntakeAnswers } from './intake-answers';
import { INTAKE_AUDIT_ACTION, INTAKE_PHOTO_KEY_PREFIX } from './intake.constants';
import {
  IntakeFormNotFoundException,
  IntakePhotoNotFoundException,
  InvalidPhotoException,
} from './intake.exceptions';
import { toAnatomySegment, toIntakeForm, toIntakePhoto, toIntakeSummary, toPainPoints } from './intake.mapper';
import { IntakeRepository, type AnatomySegmentRow, type IntakeFormRow } from './intake.repository';

/** An uploaded file as multer hands it over (memory storage). */
export interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

/** Who is submitting: the client online, or staff typing in the paper form on site. */
type Submitter =
  | { kind: 'client'; client: CurrentClientAccount }
  | { kind: 'staff'; staff: CurrentStaff };

const IMAGE_TYPES: ReadonlyArray<{ contentType: IntakePhotoContentType; extension: string; matches: (b: Buffer) => boolean }> = [
  { contentType: 'image/jpeg', extension: 'jpg', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    contentType: 'image/png',
    extension: 'png',
    matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    contentType: 'image/webp',
    extension: 'webp',
    matches: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  },
];

/**
 * Part 2, the health questionnaire (the old intake.service.js and its portal and CRM routes, PRD
 * C.4.6). One form per visit, created when the booking or pro-bono application is; the client fills
 * it in online, or staff type in the paper form on site. Staff reads and writes are recorded in
 * clinical.access_log. Answers are never logged or put in audit_log.
 */
@Injectable()
export class IntakeFormsService {
  private segmentsById?: Promise<Map<string, AnatomySegmentRow>>;

  constructor(
    private readonly intake: IntakeRepository,
    private readonly contacts: ContactsRepository,
    private readonly access: ContactAccessService,
    private readonly storage: FileStorage,
    private readonly accessLog: ClinicalAccessLogRepository,
    private readonly audit: AuditLogRepository,
    private readonly db: DatabaseService,
  ) {}

  async anatomySegments(): Promise<AnatomySegment[]> {
    return [...(await this.segments()).values()].map(toAnatomySegment);
  }

  // ── Portal ─────────────────────────────────────────────────────────────────────────────

  async listForClient(client: CurrentClientAccount, contactId?: string): Promise<IntakeFormSummary[]> {
    const { contact } = await this.access.requireOwned(client, contactId);
    return (await this.intake.listForContact(contact.id)).map(toIntakeSummary);
  }

  async getForClient(client: CurrentClientAccount, intakeId: string): Promise<IntakeForm> {
    return this.toForm(await this.ownedForm(client, intakeId));
  }

  async prefillForClient(client: CurrentClientAccount, contactId?: string): Promise<IntakePrefill | null> {
    const { contact } = await this.access.requireOwned(client, contactId);
    return this.prefill(contact.id);
  }

  async submitForClient(client: CurrentClientAccount, intakeId: string, input: SubmitIntakeDto, info: ClientInfo): Promise<IntakeForm> {
    const form = await this.ownedForm(client, intakeId);
    // A walk-in fills it in on the clinic tablet.
    return this.submit(form, input, form.booked_via === 'walk_in' ? 'walk_in_tablet' : 'online', { kind: 'client', client }, info);
  }

  /** Stores the photo, then records it; a replaced photo's file is kept (clinical files aren't deleted). */
  async uploadPhotoForClient(
    client: CurrentClientAccount,
    intakeId: string,
    side: PosturePhotoSide,
    file: UploadedPhoto | undefined,
    info: ClientInfo,
  ): Promise<IntakePhoto> {
    const form = await this.ownedForm(client, intakeId);
    if (!file || file.size === 0) {
      throw new ValidationFailedException([{ field: 'photo', messages: ['Choose a photo to upload'] }]);
    }
    const type = IMAGE_TYPES.find((candidate) => candidate.matches(file.buffer));
    if (!type) {
      throw new InvalidPhotoException();
    }

    const storageKey = `${INTAKE_PHOTO_KEY_PREFIX}/${form.id}/${side}-${randomUUID()}.${type.extension}`;
    try {
      await this.storage.put(storageKey, file.buffer, type.contentType);
    } catch (error) {
      throw new ServiceUnavailableDomainException('We couldn’t save the photo. Please try again shortly.', error);
    }

    const saved = await this.db.transaction(async (tx) => {
      const { row, replacedKey } = await this.intake.savePhoto(
        {
          contactId: form.contact_id,
          intakeId: form.id,
          side,
          storageKey,
          contentType: type.contentType,
          sizeBytes: file.size,
          uploadedBy: null,
        },
        tx,
      );
      await this.audit.record(
        {
          ...this.actor({ kind: 'client', client }),
          action: INTAKE_AUDIT_ACTION.photoUploaded,
          entityType: 'intake_form',
          entityId: form.id,
          after: { side, replaced: replacedKey !== null },
          requestId: info.requestId,
          ipAddress: info.ipAddress,
        },
        tx,
      );
      return row;
    });
    return toIntakePhoto(saved);
  }

  // ── CRM (every read and write goes to clinical.access_log) ────────────────────────────

  async listForStaff(staff: CurrentStaff, contactId: string, info: ClientInfo): Promise<IntakeFormSummary[]> {
    const contact = await this.contacts.findById(contactId);
    if (!contact) {
      throw new ClientNotFoundException();
    }
    await this.logAccess(staff, contact.id, 'view', 'intake_form_list', undefined, info);
    return (await this.intake.listForContact(contact.id)).map(toIntakeSummary);
  }

  async getForStaff(staff: CurrentStaff, intakeId: string, info: ClientInfo): Promise<IntakeForm> {
    const form = await this.requireForm(intakeId);
    await this.logAccess(staff, form.contact_id, 'view', 'intake_form', form.id, info);
    return this.toForm(form);
  }

  async prefillForStaff(staff: CurrentStaff, contactId: string, info: ClientInfo): Promise<IntakePrefill | null> {
    const contact = await this.contacts.findById(contactId);
    if (!contact) {
      throw new ClientNotFoundException();
    }
    await this.logAccess(staff, contact.id, 'view', 'intake_prefill', undefined, info);
    return this.prefill(contact.id);
  }

  /** The paper form a client filled in on site after missing the deadline (old onsite-intake). */
  async submitForStaff(staff: CurrentStaff, intakeId: string, input: SubmitIntakeDto, info: ClientInfo): Promise<IntakeForm> {
    const form = await this.requireForm(intakeId);
    return this.submit(form, input, 'onsite_manual', { kind: 'staff', staff }, info);
  }

  async photoForStaff(staff: CurrentStaff, intakeId: string, side: PosturePhotoSide, info: ClientInfo): Promise<StoredFile> {
    const form = await this.requireForm(intakeId);
    const photo = await this.intake.findPhoto(form.id, side);
    if (!photo) {
      throw new IntakePhotoNotFoundException();
    }
    let file: StoredFile;
    try {
      file = await this.storage.get(photo.storage_key);
    } catch (error) {
      if (error instanceof StoredFileNotFoundError) {
        throw new IntakePhotoNotFoundException();
      }
      throw new ServiceUnavailableDomainException('We couldn’t load the photo. Please try again shortly.', error);
    }
    await this.logAccess(staff, form.contact_id, 'view', 'intake_photo', photo.id, info);
    return { body: file.body, contentType: photo.content_type };
  }

  // ── For booking and pro-bono (called inside their transactions) ──────────────────────

  /** The pending form for a new booking. Idempotent. */
  createForBooking(contactId: string, bookingId: string, tx: Queryable): Promise<string> {
    return this.intake.createForBooking(contactId, bookingId, tx);
  }

  /** The pending form for a pro-bono application, before it has a slot. Idempotent. */
  createForProbonoEntry(contactId: string, probonoEntryId: string, tx: Queryable): Promise<string> {
    return this.intake.createForProbonoEntry(contactId, probonoEntryId, tx);
  }

  /** When a pro-bono application is given a slot, its form moves to the booking. */
  attachProbonoFormToBooking(probonoEntryId: string, bookingId: string, tx: Queryable): Promise<void> {
    return this.intake.attachProbonoFormToBooking(probonoEntryId, bookingId, tx);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────────────

  private async submit(
    form: IntakeFormRow,
    input: SubmitIntakeDto,
    via: IntakeCompletedVia,
    submitter: Submitter,
    info: ClientInfo,
  ): Promise<IntakeForm> {
    const { answers, painPoints } = await this.validateSubmission(input);

    await this.db.transaction(async (tx) => {
      const current = await this.intake.findByIdForUpdate(form.id, tx);
      if (!current) {
        throw new IntakeFormNotFoundException();
      }
      await this.intake.submit(current.id, { answers, painPoints, problemDescription: input.problemDescription ?? null }, via, tx);
      if (current.probono_entry_id) {
        await this.intake.waitlistProbonoEntry(current.probono_entry_id, tx);
      }
      await this.audit.record(
        {
          ...this.actor(submitter),
          action: INTAKE_AUDIT_ACTION.submitted,
          entityType: 'intake_form',
          entityId: current.id,
          after: { via: current.completed_via ?? via, firstSubmission: current.status !== 'completed' },
          requestId: info.requestId,
          ipAddress: info.ipAddress,
        },
        tx,
      );
      if (submitter.kind === 'staff') {
        await this.logAccess(submitter.staff, current.contact_id, 'edit', 'intake_form', current.id, info, tx);
      }
    });

    return this.toForm(await this.requireForm(form.id));
  }

  /** Answers against the question set, and pain points: known segments, each once, unique ranks. */
  private async validateSubmission(
    input: SubmitIntakeDto,
  ): Promise<{ answers: IntakeAnswers; painPoints: IntakePainPointInput[] }> {
    const parsed = parseIntakeAnswers(input.answers);
    const errors: ApiFieldError[] = [...parsed.errors];
    const segments = await this.segments();
    const seenSegments = new Set<string>();
    const seenRanks = new Set<number>();
    input.painPoints.forEach((point, index) => {
      if (!segments.has(point.segmentId)) {
        errors.push({ field: `painPoints.${index}.segmentId`, messages: ['That body area isn’t on the diagram'] });
      } else if (seenSegments.has(point.segmentId)) {
        errors.push({ field: `painPoints.${index}.segmentId`, messages: ['Choose each body area once'] });
      }
      if (seenRanks.has(point.rank)) {
        errors.push({ field: `painPoints.${index}.rank`, messages: ['Give each pain point a different rank'] });
      }
      seenSegments.add(point.segmentId);
      seenRanks.add(point.rank);
    });
    if (errors.length > 0 || !parsed.answers) {
      throw new ValidationFailedException(errors);
    }
    const painPoints = input.painPoints
      .map((point) => ({ segmentId: point.segmentId, rank: point.rank }))
      .sort((a, b) => a.rank - b.rank);
    return { answers: parsed.answers, painPoints };
  }

  /** The last completed form on the current question set. Photos never prefill (PRD C.4.6.3). */
  private async prefill(contactId: string): Promise<IntakePrefill | null> {
    const last = await this.intake.lastCompleted(contactId);
    if (!last?.completed_at) {
      return null;
    }
    return {
      fromIntakeId: last.id,
      completedAt: last.completed_at.toISOString(),
      answers: last.answers as IntakeAnswers,
      painPoints: toPainPoints(last.pain_points, await this.segments()),
      problemDescription: last.problem_description,
    };
  }

  /** The form, if it belongs to the client or one of their dependents; otherwise not found. */
  private async ownedForm(client: CurrentClientAccount, intakeId: string): Promise<IntakeFormRow> {
    const form = await this.requireForm(intakeId);
    if (!(await this.contacts.findOwned(client.id, client.contactId, form.contact_id))) {
      throw new IntakeFormNotFoundException();
    }
    return form;
  }

  private async requireForm(intakeId: string): Promise<IntakeFormRow> {
    const form = await this.intake.findById(intakeId);
    if (!form) {
      throw new IntakeFormNotFoundException();
    }
    return form;
  }

  private async toForm(form: IntakeFormRow): Promise<IntakeForm> {
    const [photos, segments] = await Promise.all([this.intake.photos(form.id), this.segments()]);
    return toIntakeForm(form, photos, segments);
  }

  /** anatomy_segments is fixed reference data (loaded by a migration), so it's read once. */
  private segments(): Promise<Map<string, AnatomySegmentRow>> {
    this.segmentsById ??= this.intake.anatomySegments().then((rows) => new Map(rows.map((row) => [row.id, row])));
    this.segmentsById.catch(() => {
      this.segmentsById = undefined;
    });
    return this.segmentsById;
  }

  private actor(submitter: Submitter): Pick<AuditEntry, 'actorType' | 'actorId' | 'actorLabel'> {
    return submitter.kind === 'client'
      ? { actorType: 'patient', actorId: submitter.client.id, actorLabel: submitter.client.email }
      : { actorType: 'staff', actorId: submitter.staff.id, actorLabel: submitter.staff.name };
  }

  private logAccess(
    staff: CurrentStaff,
    contactId: string,
    action: 'view' | 'edit',
    entityType: string,
    entityId: string | undefined,
    info: ClientInfo,
    db?: Queryable,
  ): Promise<void> {
    return this.accessLog.record(
      { staffUserId: staff.id, contactId, action, entityType, entityId, requestId: info.requestId, ipAddress: info.ipAddress },
      db,
    );
  }
}
