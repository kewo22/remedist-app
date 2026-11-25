import { applyDecorators } from '@nestjs/common';
import { isDateOnly, isTimeOfDay, isValidPhone, normalizePhone } from '@remedist/shared';
import { Transform } from 'class-transformer';
import { ValidateBy, ValidationOptions, buildMessage } from 'class-validator';

// DTO property decorators for the formats the clinic uses. The rules themselves live in
// @remedist/shared so the web app validates exactly the same way.

/** "YYYY-MM-DD", a real calendar date, clinic local. */
export function IsDateOnly(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isDateOnly',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isDateOnly(value),
        defaultMessage: buildMessage((each) => `${each}$property must be a date in YYYY-MM-DD format`, options),
      },
    },
    options,
  );
}

/** 24-hour "HH:MM", clinic local. */
export function IsTimeOfDay(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isTimeOfDay',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isTimeOfDay(value),
        defaultMessage: buildMessage((each) => `${each}$property must be a 24-hour time in HH:MM format`, options),
      },
    },
    options,
  );
}

/**
 * Normalises a phone number to "+<digits>" (the stored form) and then checks it.
 * The handler receives the normalised value.
 */
export function IsPhone(options?: ValidationOptions): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizePhone(value) : value)),
    ValidateBy(
      {
        name: 'isPhone',
        validator: {
          validate: (value: unknown) => typeof value === 'string' && isValidPhone(value),
          defaultMessage: buildMessage(
            (each) => `${each}$property must be a phone number with country code, e.g. +94 77 123 4567`,
            options,
          ),
        },
      },
      options,
    ),
  );
}
