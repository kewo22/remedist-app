import { applyDecorators } from '@nestjs/common';
import { normalizeEmail, normalizeIdNumber } from '@remedist/shared';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { IsPhone } from '../../../common/validation/validation.decorators';

// Property decorators shared by the contact DTOs. In update requests an omitted field keeps its
// value and null clears it; for text, an empty string also clears it (as the old app).

export const NAME_MAX_LENGTH = 120;
const TEXT_MAX_LENGTH = 500;

const trimmed = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const trimmedOrNull = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const text = value.trim();
  return text === '' ? null : text;
});

/** Optional, may be null to clear. */
export function NullableText(maxLength = TEXT_MAX_LENGTH): PropertyDecorator {
  return applyDecorators(trimmedOrNull, IsOptional(), IsString(), MaxLength(maxLength));
}

/** Optional, may be null to clear; normalised to +<digits>. */
export function NullablePhone(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : value)),
    IsOptional(),
    IsPhone(),
  );
}

/** Optional, may be null to clear; trimmed and lower-cased. */
export function NullableEmail(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => {
      if (typeof value !== 'string') {
        return value;
      }
      const email = normalizeEmail(value);
      return email === '' ? null : email;
    }),
    IsOptional(),
    IsEmail({}, { message: 'Enter a valid email address' }),
    MaxLength(254),
  );
}

/** Optional but never null: when present it must be a non-empty name. */
export function OptionalName(): PropertyDecorator {
  return applyDecorators(
    trimmed,
    ValidateIf((_, value: unknown) => value !== undefined),
    IsString(),
    IsNotEmpty({ message: 'Enter a name' }),
    MaxLength(NAME_MAX_LENGTH),
  );
}

/** Required name. */
export function RequiredName(): PropertyDecorator {
  return applyDecorators(trimmed, IsString(), IsNotEmpty({ message: 'Enter a name' }), MaxLength(NAME_MAX_LENGTH));
}

/** Optional but never null (for fields such as stage or gender that can't be cleared). */
export const PresentIfGiven = (): PropertyDecorator => ValidateIf((_, value: unknown) => value !== undefined);

/** ISO 3166-1 alpha-2, upper-cased: "lk" → "LK". */
export function CountryCode(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)),
    PresentIfGiven(),
    IsString(),
    Matches(/^[A-Z]{2}$/, { message: 'nationality must be a two-letter country code, e.g. LK' }),
  );
}

/** NIC or passport number, trimmed and upper-cased; empty means null. */
export function NullableIdNumber(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeIdNumber(value) : value)),
    IsOptional(),
    IsString(),
    MaxLength(40),
  );
}
