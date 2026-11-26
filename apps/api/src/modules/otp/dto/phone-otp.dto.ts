import {
  ONE_TIME_CODE_PATTERN,
  PHONE_OTP_PURPOSES,
  type PhoneOtpPurpose,
  type PhoneOtpSendRequest,
  type PhoneOtpVerifyRequest,
} from '@remedist/shared';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsPhone } from '../../../common/validation/validation.decorators';

const trimmed = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class PhoneOtpSendDto implements PhoneOtpSendRequest {
  /** Normalised to +<digits> before the handler sees it. */
  @IsPhone()
  phoneNumber!: string;

  @IsIn(PHONE_OTP_PURPOSES)
  purpose!: PhoneOtpPurpose;

  @IsOptional()
  @MaxLength(4096)
  @IsString()
  turnstileToken?: string;
}

export class PhoneOtpVerifyDto implements PhoneOtpVerifyRequest {
  @IsPhone()
  phoneNumber!: string;

  @IsIn(PHONE_OTP_PURPOSES)
  purpose!: PhoneOtpPurpose;

  @Matches(ONE_TIME_CODE_PATTERN, { message: 'Enter the 6-digit code' })
  @IsString()
  @trimmed
  code!: string;
}
