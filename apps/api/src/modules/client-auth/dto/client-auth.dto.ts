import { applyDecorators } from '@nestjs/common';
import {
  CLIENT_PASSWORD_MIN_LENGTH,
  ONE_TIME_CODE_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_RESET_CHANNELS,
  normalizeEmail,
  type ClientGoogleSignInRequest,
  type ClientLoginRequest,
  type ClientRegisterRequest,
  type ClientVerifyEmailRequest,
  type ForgotPasswordRequest,
  type PasswordResetChannel,
  type ResetPasswordRequest,
} from '@remedist/shared';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Request bodies for the portal auth routes. Each implements its contract type, so a contract
// change breaks the build until the DTO matches.

const trimmedLowerEmail = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? normalizeEmail(value) : value,
);
const trimmed = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** A new password: the old app's minimum length, capped so huge bodies aren't hashed. */
function NewPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(CLIENT_PASSWORD_MIN_LENGTH, { message: `Password must be at least ${CLIENT_PASSWORD_MIN_LENGTH} characters` }),
    MaxLength(PASSWORD_MAX_LENGTH),
  );
}

/** A 6-digit verification or reset code. */
function Code(): PropertyDecorator {
  return applyDecorators(trimmed, IsString(), Matches(ONE_TIME_CODE_PATTERN, { message: 'Enter the 6-digit code' }));
}

/** Trimmed and lower-cased before validation, so lookups and limits compare like with like. */
function Email(): PropertyDecorator {
  return applyDecorators(trimmedLowerEmail, IsEmail({}, { message: 'Enter a valid email address' }), MaxLength(254));
}

export class ClientRegisterDto implements ClientRegisterRequest {
  @trimmed
  @MaxLength(120)
  @IsNotEmpty({ message: 'Enter your name' })
  @IsString()
  name!: string;

  @Email()
  email!: string;

  @NewPassword()
  password!: string;
}

export class ClientVerifyEmailDto implements ClientVerifyEmailRequest {
  @Email()
  email!: string;

  @Code()
  code!: string;
}

export class ClientLoginDto implements ClientLoginRequest {
  @Email()
  email!: string;

  @MaxLength(PASSWORD_MAX_LENGTH)
  @IsNotEmpty()
  @IsString()
  password!: string;
}

export class ClientGoogleSignInDto implements ClientGoogleSignInRequest {
  // Google ID tokens are a few KB at most.
  @MaxLength(8192)
  @IsNotEmpty()
  @IsString()
  idToken!: string;
}

export class ForgotPasswordDto implements ForgotPasswordRequest {
  @Email()
  email!: string;

  @IsIn(PASSWORD_RESET_CHANNELS)
  channel!: PasswordResetChannel;

  @IsOptional()
  @MaxLength(4096)
  @IsString()
  turnstileToken?: string;
}

export class ResetPasswordDto implements ResetPasswordRequest {
  @Email()
  email!: string;

  @IsIn(PASSWORD_RESET_CHANNELS)
  channel!: PasswordResetChannel;

  @Code()
  code!: string;

  @NewPassword()
  newPassword!: string;
}
