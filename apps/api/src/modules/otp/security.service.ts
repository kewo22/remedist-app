import { Injectable } from '@nestjs/common';
import type { BlocklistEntry, SecurityOverview } from '@remedist/shared';
import { AuditLogRepository } from '../../common/audit/audit-log.repository';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ResourceNotFoundException, ValidationFailedException } from '../../common/exceptions/common.exceptions';
import { AppConfig } from '../../config/app-config';
import { DatabaseService } from '../../database/database.service';
import { CreateBlockDto } from './dto/create-block.dto';
import { BLOCKLIST_LIST_LIMIT, SECURITY_TOP_LIMIT } from './otp.constants';
import { BlocklistRow, OtpRepository } from './otp.repository';

const ONE_DAY = 24 * 60 * 60;

function toEntry(row: BlocklistRow): BlocklistEntry {
  return {
    id: row.id,
    phoneNumber: row.phone_number,
    email: row.email,
    ipAddress: row.ip_address,
    reason: row.reason,
    createdByLabel: row.created_by_label,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
  };
}

/** The CRM security panel: code-sending volume and the OTP blocklist. Every change is audited. */
@Injectable()
export class SecurityService {
  constructor(
    private readonly repository: OtpRepository,
    private readonly audit: AuditLogRepository,
    private readonly config: AppConfig,
    private readonly db: DatabaseService,
  ) {}

  async overview(): Promise<SecurityOverview> {
    const [sends24h, dailySendCount, topPhones, topEmails, topIps] = await Promise.all([
      this.repository.countInWindow(ONE_DAY),
      this.repository.countToday(),
      this.repository.topInWindow('phone_number', ONE_DAY, SECURITY_TOP_LIMIT),
      this.repository.topInWindow('email', ONE_DAY, SECURITY_TOP_LIMIT),
      this.repository.topInWindow('ip_address', ONE_DAY, SECURITY_TOP_LIMIT),
    ]);
    return { sends24h, dailyCap: this.config.otp.dailySendCap, dailySendCount, topPhones, topEmails, topIps };
  }

  async listBlocks(): Promise<BlocklistEntry[]> {
    return (await this.repository.listBlocks(BLOCKLIST_LIST_LIMIT)).map(toEntry);
  }

  async addBlock(input: CreateBlockDto, staff: CurrentStaff, client: ClientInfo): Promise<BlocklistEntry> {
    if (!input.phoneNumber && !input.email && !input.ipAddress) {
      throw new ValidationFailedException([
        { field: 'phoneNumber', messages: ['Give a phone number, email or IP address to block'] },
      ]);
    }
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new ValidationFailedException([{ field: 'expiresAt', messages: ['expiresAt must be in the future'] }]);
    }

    return this.db.transaction(async (tx) => {
      const row = await this.repository.addBlock(
        {
          phoneNumber: input.phoneNumber ?? null,
          email: input.email ?? null,
          ipAddress: input.ipAddress ?? null,
          reason: input.reason,
          createdBy: staff.id,
          createdByLabel: staff.name,
          expiresAt,
        },
        tx,
      );
      const entry = toEntry(row);
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staff.id,
          actorLabel: staff.name,
          action: 'otp_blocklist.added',
          entityType: 'otp_blocklist',
          entityId: row.id,
          after: entry,
          requestId: client.requestId,
          ipAddress: client.ipAddress,
        },
        tx,
      );
      return entry;
    });
  }

  async removeBlock(id: string, staff: CurrentStaff, client: ClientInfo): Promise<void> {
    await this.db.transaction(async (tx) => {
      const removed = await this.repository.removeBlock(id, tx);
      if (!removed) {
        throw new ResourceNotFoundException('That block doesn’t exist or was already removed.');
      }
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staff.id,
          actorLabel: staff.name,
          action: 'otp_blocklist.removed',
          entityType: 'otp_blocklist',
          entityId: id,
          before: toEntry(removed),
          requestId: client.requestId,
          ipAddress: client.ipAddress,
        },
        tx,
      );
    });
  }
}
