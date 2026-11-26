import { normalizeEmail, type CreateBlockRequest } from '@remedist/shared';
import { Transform } from 'class-transformer';
import { IsEmail, IsIP, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsPhone } from '../../../common/validation/validation.decorators';

const trimmed = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** At least one of phoneNumber, email and ipAddress; the service checks that. */
export class CreateBlockDto implements CreateBlockRequest {
  @IsOptional()
  @IsPhone()
  phoneNumber?: string;

  @IsOptional()
  @MaxLength(254)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeEmail(value) : value))
  email?: string;

  @IsOptional()
  @IsIP(undefined, { message: 'Enter a valid IPv4 or IPv6 address' })
  @trimmed
  ipAddress?: string;

  @MaxLength(500)
  @IsNotEmpty({ message: 'Give a reason for the block' })
  @IsString()
  @trimmed
  reason!: string;

  /** ISO 8601. Omit for a permanent block. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'expiresAt must be an ISO 8601 date-time' })
  expiresAt?: string;
}
