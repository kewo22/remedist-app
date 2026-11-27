import {
  CONTACT_GENDERS,
  ID_TYPES,
  type CompletePart1Request,
  type ContactGender,
  type IdType,
} from '@remedist/shared';
import { Transform } from 'class-transformer';
import { Equals, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsDateOnly } from '../../../common/validation/validation.decorators';
import {
  NullableEmail,
  NullableIdNumber,
  NullablePhone,
  NullableText,
  RequiredName,
} from '../../contacts/dto/contact-fields';
import { ACCEPT_GENERAL_TERMS_MESSAGE, ACCEPT_REFUND_POLICY_MESSAGE } from '../../terms/dto/terms.dto';

/** Values that may be null but must be sent: undefined fails, null passes. */
const NullAllowed = (): PropertyDecorator => ValidateIf((_, value: unknown) => value !== null);

export class CompletePart1Dto implements CompletePart1Request {
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @RequiredName()
  name!: string;

  @IsIn(CONTACT_GENDERS)
  gender!: ContactGender;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'nationality must be a two-letter country code, e.g. LK' })
  nationality!: string;

  /** Both null only for a dependent; the service checks the pair. */
  @NullAllowed()
  @IsIn(ID_TYPES)
  idType!: IdType | null;

  @NullableIdNumber()
  idNumber!: string | null;

  @IsDateOnly()
  dateOfBirth!: string;

  @NullableEmail()
  email?: string | null;

  @NullablePhone()
  phone?: string | null;

  /** From /public/otp/verify with purpose 'phone_change', for a new number. */
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

  @NullableText()
  referralText?: string | null;

  @NullAllowed()
  @IsInt({ message: 'termsVersion must be the version of the terms shown, or null if none is published' })
  @Min(1)
  termsVersion!: number | null;

  @Equals(true, { message: ACCEPT_GENERAL_TERMS_MESSAGE })
  acceptGeneralTerms!: true;

  @Equals(true, { message: ACCEPT_REFUND_POLICY_MESSAGE })
  acceptRefundPolicy!: true;
}
