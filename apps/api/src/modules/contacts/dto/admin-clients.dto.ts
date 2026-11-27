import {
  CLIENT_LIST_MAX_PAGE_SIZE,
  CLIENT_LIST_SORT_FIELDS,
  CONTACT_GENDERS,
  CONTACT_STAGES,
  ID_TYPES,
  MAX_REMINDER_FREQUENCY_DAYS,
  MIN_REMINDER_FREQUENCY_DAYS,
  type ClientListQuery,
  type ClientListSortField,
  type ContactGender,
  type ContactStage,
  type CorrectIdentityRequest,
  type IdType,
  type StaffUpdateClientRequest,
  type UpdatePaymentSettingsRequest,
  type UpdateReferralRequest,
} from '@remedist/shared';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsDateOnly } from '../../../common/validation/validation.decorators';
import {
  CountryCode,
  NullableEmail,
  NullableIdNumber,
  NullablePhone,
  NullableText,
  OptionalName,
  PresentIfGiven,
} from './contact-fields';

const SEARCH_MAX_LENGTH = 100;

/** Query strings are text: only "true" and "false" are accepted, never implicit conversion. */
const queryBoolean = Transform(({ value }: { value: unknown }) => {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
});

export class ClientListQueryDto implements ClientListQuery {
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  q?: string;

  @IsOptional()
  @IsIn(CONTACT_STAGES)
  stage?: ContactStage;

  @queryBoolean
  @IsOptional()
  @IsBoolean({ message: 'includeArchived must be true or false' })
  includeArchived?: boolean;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CLIENT_LIST_MAX_PAGE_SIZE)
  pageSize?: number;

  @IsOptional()
  @IsIn(CLIENT_LIST_SORT_FIELDS)
  sortBy?: ClientListSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}

export class ClientLookupQueryDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Type part of a name or registration number' })
  @MaxLength(SEARCH_MAX_LENGTH)
  q!: string;
}

export class StaffUpdateClientDto implements StaffUpdateClientRequest {
  @OptionalName()
  name?: string;

  @NullableEmail()
  email?: string | null;

  @NullablePhone()
  phone?: string | null;

  @NullableText(120)
  profession?: string | null;

  @NullableText()
  address?: string | null;

  @NullableText(120)
  backupContactName?: string | null;

  @NullableText(60)
  backupContactRelation?: string | null;

  @NullablePhone()
  backupContactPhone?: string | null;

  @PresentIfGiven()
  @IsIn(CONTACT_STAGES)
  stage?: ContactStage;
}

export class CorrectIdentityDto implements CorrectIdentityRequest {
  @OptionalName()
  name?: string;

  @PresentIfGiven()
  @IsIn(CONTACT_GENDERS)
  gender?: ContactGender;

  @CountryCode()
  nationality?: string;

  @IsOptional()
  @IsIn(ID_TYPES)
  idType?: IdType | null;

  @NullableIdNumber()
  idNumber?: string | null;

  @PresentIfGiven()
  @IsDateOnly()
  dateOfBirth?: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateReferralDto implements UpdateReferralRequest {
  /** Required: a contact id, or null to clear. */
  @ValidateIf((_, value: unknown) => value !== null)
  @IsUUID('all', { message: 'referredByContactId must be a client id or null' })
  referredByContactId!: string | null;
}

export class UpdatePaymentSettingsDto implements UpdatePaymentSettingsRequest {
  @PresentIfGiven()
  @IsBoolean()
  payAfterSession?: boolean;

  @PresentIfGiven()
  @IsInt()
  @Min(MIN_REMINDER_FREQUENCY_DAYS)
  @Max(MAX_REMINDER_FREQUENCY_DAYS)
  reminderFrequencyDays?: number;
}
