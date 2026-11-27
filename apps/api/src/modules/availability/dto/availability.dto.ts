import {
  MAX_RATE_MINOR,
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  SLOT_HISTORY_MAX_LIMIT,
  type AdminSlotQuery,
  type BlockSlotRequest,
  type CreateSessionTypeRequest,
  type CreateSlotRequest,
  type SlotHistoryQuery,
  type UpdateSessionTypeRequest,
  type UpdateSlotRequest,
} from '@remedist/shared';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsDateOnly, IsTimeOfDay } from '../../../common/validation/validation.decorators';
import { NullableText, PresentIfGiven } from '../../contacts/dto/contact-fields';
import { BLOCK_REASON_MAX_LENGTH, SESSION_TYPE_NAME_MAX_LENGTH } from '../availability.constants';

const trimmed = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** A price in minor units: a positive whole number, or null for "not offered in this currency". */
function Rate(required: boolean): PropertyDecorator {
  return (target, key) => {
    ValidateIf((_, value: unknown) => value !== null && (required || value !== undefined))(target, key);
    IsInt({ message: `${String(key)} must be a whole number of minor units (cents), or null` })(target, key);
    Min(1)(target, key);
    Max(MAX_RATE_MINOR)(target, key);
  };
}

function Duration(): PropertyDecorator {
  return (target, key) => {
    IsInt({ message: `${String(key)} must be a whole number of minutes` })(target, key);
    Min(MIN_SESSION_MINUTES)(target, key);
    Max(MAX_SESSION_MINUTES)(target, key);
  };
}

// ── Session types ──────────────────────────────────────────────────────────────────────────

export class SessionTypeListQueryDto {
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsOptional()
  @IsBoolean({ message: 'includeRetired must be true or false' })
  includeRetired?: boolean;
}

export class CreateSessionTypeDto implements CreateSessionTypeRequest {
  @trimmed
  @IsString()
  @IsNotEmpty({ message: 'Give the session type a name' })
  @MaxLength(SESSION_TYPE_NAME_MAX_LENGTH)
  name!: string;

  @Duration()
  durationMinutes!: number;

  @Rate(true)
  rateLkrMinor!: number | null;

  @Rate(true)
  rateUsdMinor!: number | null;
}

export class UpdateSessionTypeDto implements UpdateSessionTypeRequest {
  @trimmed
  @PresentIfGiven()
  @IsString()
  @IsNotEmpty({ message: 'Give the session type a name' })
  @MaxLength(SESSION_TYPE_NAME_MAX_LENGTH)
  name?: string;

  @PresentIfGiven()
  @Duration()
  durationMinutes?: number;

  @Rate(false)
  rateLkrMinor?: number | null;

  @Rate(false)
  rateUsdMinor?: number | null;
}

export class SessionTypeParamsDto {
  @IsUUID()
  sessionTypeId!: string;
}

// ── Slots ──────────────────────────────────────────────────────────────────────────────────

export class AdminSlotQueryDto implements AdminSlotQuery {
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;

  @IsOptional()
  @IsUUID()
  practitionerId?: string;
}

export class CreateSlotDto implements CreateSlotRequest {
  @IsOptional()
  @IsUUID()
  practitionerId?: string;

  @IsDateOnly()
  date!: string;

  @IsTimeOfDay()
  startTime!: string;

  @IsUUID()
  sessionTypeId!: string;
}

export class UpdateSlotDto implements UpdateSlotRequest {
  @PresentIfGiven()
  @IsDateOnly()
  date?: string;

  @PresentIfGiven()
  @IsTimeOfDay()
  startTime?: string;

  @PresentIfGiven()
  @IsUUID()
  sessionTypeId?: string;

  @PresentIfGiven()
  @Duration()
  durationMinutes?: number;

  @Rate(false)
  rateLkrMinor?: number | null;

  @Rate(false)
  rateUsdMinor?: number | null;
}

export class BlockSlotDto implements BlockSlotRequest {
  @NullableText(BLOCK_REASON_MAX_LENGTH)
  reason?: string | null;
}

export class SlotParamsDto {
  @IsUUID()
  slotId!: string;
}

export class SlotHistoryQueryDto implements SlotHistoryQuery {
  @IsOptional()
  @IsUUID()
  slotId?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SLOT_HISTORY_MAX_LIMIT)
  limit?: number;
}

// ── Public ─────────────────────────────────────────────────────────────────────────────────

export class PublicSlotsQueryDto {
  @IsDateOnly()
  date!: string;

  @IsOptional()
  @IsUUID()
  practitionerId?: string;
}

export class PublicDatesQueryDto {
  @IsDateOnly()
  from!: string;

  @IsDateOnly()
  to!: string;

  @IsOptional()
  @IsUUID()
  practitionerId?: string;
}
