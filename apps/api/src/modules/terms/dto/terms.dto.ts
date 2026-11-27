import { TERMS_SECTION_MAX_LENGTH, type AcceptTermsRequest, type UpdateTermsDraftRequest } from '@remedist/shared';
import { Equals, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class UpdateTermsDraftDto implements UpdateTermsDraftRequest {
  /** May be empty while drafting; publishing needs both sections. */
  @IsString()
  @MaxLength(TERMS_SECTION_MAX_LENGTH)
  generalTermsContent!: string;

  @IsString()
  @MaxLength(TERMS_SECTION_MAX_LENGTH)
  refundPolicyContent!: string;
}

/** Both consent checkboxes, as in the old Part 1 and re-consent forms. */
export const ACCEPT_GENERAL_TERMS_MESSAGE = 'Please accept the Terms & Conditions to continue';
export const ACCEPT_REFUND_POLICY_MESSAGE = 'Please accept the no-refund policy to continue';

export class AcceptTermsDto implements AcceptTermsRequest {
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsInt()
  @Min(1)
  termsVersion!: number;

  @Equals(true, { message: ACCEPT_GENERAL_TERMS_MESSAGE })
  acceptGeneralTerms!: true;

  @Equals(true, { message: ACCEPT_REFUND_POLICY_MESSAGE })
  acceptRefundPolicy!: true;
}
