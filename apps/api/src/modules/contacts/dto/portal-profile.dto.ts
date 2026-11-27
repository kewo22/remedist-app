import {
  DEPENDENT_RELATIONSHIPS,
  type CreateDependentRequest,
  type DependentRelationship,
  type UpdateClientProfileRequest,
} from '@remedist/shared';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { NullablePhone, NullableText, RequiredName } from './contact-fields';

export class ProfileQueryDto {
  /** A dependent's contact id; omit for the account holder. */
  @IsOptional()
  @IsUUID()
  contactId?: string;
}

export class UpdateClientProfileDto implements UpdateClientProfileRequest {
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @NullablePhone()
  phone?: string | null;

  /** From /public/otp/verify with purpose 'phone_change', for the new number. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  phoneVerificationToken?: string;

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
}

export class CreateDependentDto implements CreateDependentRequest {
  @RequiredName()
  name!: string;

  @IsIn(DEPENDENT_RELATIONSHIPS)
  relationship!: DependentRelationship;
}
