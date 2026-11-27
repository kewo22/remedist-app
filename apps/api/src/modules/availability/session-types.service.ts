import { Injectable } from '@nestjs/common';
import type { SessionType } from '@remedist/shared';
import { AuditLogRepository } from '../../common/audit/audit-log.repository';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ValidationFailedException } from '../../common/exceptions/common.exceptions';
import { DatabaseService, Queryable } from '../../database/database.service';
import { isUniqueViolation } from '../../database/pg-errors';
import { SESSION_TYPE_AUDIT_ACTION, SESSION_TYPE_ENTITY } from './availability.constants';
import {
  LastSessionTypeException,
  SessionTypeNameTakenException,
  SessionTypeNotFoundException,
} from './availability.exceptions';
import { toSessionType } from './availability.mapper';
import {
  AvailabilityRepository,
  SESSION_TYPE_NAME_INDEX,
  type SessionTypeFields,
  type SessionTypeRow,
} from './availability.repository';
import { CreateSessionTypeDto, UpdateSessionTypeDto } from './dto/availability.dto';

/** At least one price; reported on the LKR field, as the form shows it first. */
export function requireARate(rateLkrMinor: number | null, rateUsdMinor: number | null): void {
  if (rateLkrMinor === null && rateUsdMinor === null) {
    throw new ValidationFailedException([{ field: 'rateLkrMinor', messages: ['Set a price in at least one currency'] }]);
  }
}

/**
 * Session types (the old /api/admin/availability/session-types): the kinds of session slots are
 * opened as. Editing one never re-prices slots already opened, since each slot keeps its own copy.
 * Retired types are deactivated, never deleted, and the last active one can't be retired.
 */
@Injectable()
export class SessionTypesService {
  constructor(
    private readonly availability: AvailabilityRepository,
    private readonly audit: AuditLogRepository,
    private readonly db: DatabaseService,
  ) {}

  async list(includeRetired: boolean): Promise<SessionType[]> {
    return (await this.availability.listSessionTypes(includeRetired)).map(toSessionType);
  }

  /** The walk-in kiosk's type when nobody picks one: the oldest active (the standard session). */
  async defaultType(): Promise<SessionTypeRow | undefined> {
    return this.availability.defaultSessionType();
  }

  async create(input: CreateSessionTypeDto, staff: CurrentStaff, info: ClientInfo): Promise<SessionType> {
    requireARate(input.rateLkrMinor, input.rateUsdMinor);
    const created = await this.write(async (tx) => {
      const row = await this.availability.createSessionType(input, tx);
      await this.record(staff, info, SESSION_TYPE_AUDIT_ACTION.created, row.id, undefined, input, tx);
      return row;
    });
    return toSessionType(created);
  }

  async update(id: string, input: UpdateSessionTypeDto, staff: CurrentStaff, info: ClientInfo): Promise<SessionType> {
    const updated = await this.write(async (tx) => {
      const current = await this.availability.findSessionTypeForUpdate(id, tx);
      if (!current) {
        throw new SessionTypeNotFoundException();
      }
      const before = fieldsOf(current);
      const after: SessionTypeFields = {
        name: input.name ?? before.name,
        durationMinutes: input.durationMinutes ?? before.durationMinutes,
        rateLkrMinor: input.rateLkrMinor !== undefined ? input.rateLkrMinor : before.rateLkrMinor,
        rateUsdMinor: input.rateUsdMinor !== undefined ? input.rateUsdMinor : before.rateUsdMinor,
      };
      requireARate(after.rateLkrMinor, after.rateUsdMinor);
      if (JSON.stringify(before) === JSON.stringify(after)) {
        return current;
      }
      const row = await this.availability.updateSessionType(id, after, tx);
      await this.record(staff, info, SESSION_TYPE_AUDIT_ACTION.updated, id, before, after, tx);
      return row;
    });
    return toSessionType(updated);
  }

  /** Slots already opened as this type keep working; it just stops being offered. */
  async retire(id: string, staff: CurrentStaff, info: ClientInfo): Promise<SessionType> {
    const row = await this.db.transaction(async (tx) => {
      const activeIds = await this.availability.lockActiveSessionTypeIds(tx);
      const current = await this.availability.findSessionTypeForUpdate(id, tx);
      if (!current) {
        throw new SessionTypeNotFoundException();
      }
      if (!current.is_active) {
        return current;
      }
      if (activeIds.length <= 1) {
        throw new LastSessionTypeException();
      }
      const retired = await this.availability.setSessionTypeActive(id, false, tx);
      await this.record(staff, info, SESSION_TYPE_AUDIT_ACTION.retired, id, undefined, undefined, tx);
      return retired;
    });
    return toSessionType(row);
  }

  async restore(id: string, staff: CurrentStaff, info: ClientInfo): Promise<SessionType> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.availability.findSessionTypeForUpdate(id, tx);
      if (!current) {
        throw new SessionTypeNotFoundException();
      }
      if (current.is_active) {
        return current;
      }
      const restored = await this.availability.setSessionTypeActive(id, true, tx);
      await this.record(staff, info, SESSION_TYPE_AUDIT_ACTION.restored, id, undefined, undefined, tx);
      return restored;
    });
    return toSessionType(row);
  }

  /** A write that may hit the unique name index (any case). */
  private async write(work: (tx: Queryable) => Promise<SessionTypeRow>): Promise<SessionTypeRow> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (isUniqueViolation(error, SESSION_TYPE_NAME_INDEX)) {
        throw new SessionTypeNameTakenException(error);
      }
      throw error;
    }
  }

  private record(
    staff: CurrentStaff,
    info: ClientInfo,
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
    tx: Queryable,
  ): Promise<void> {
    return this.audit.record(
      {
        actorType: 'staff',
        actorId: staff.id,
        actorLabel: staff.name,
        action,
        entityType: SESSION_TYPE_ENTITY,
        entityId,
        before,
        after,
        requestId: info.requestId,
        ipAddress: info.ipAddress,
      },
      tx,
    );
  }
}

function fieldsOf(row: SessionTypeRow): SessionTypeFields {
  return {
    name: row.name,
    durationMinutes: row.duration_minutes,
    rateLkrMinor: row.rate_lkr_minor === null ? null : Number(row.rate_lkr_minor),
    rateUsdMinor: row.rate_usd_minor === null ? null : Number(row.rate_usd_minor),
  };
}
