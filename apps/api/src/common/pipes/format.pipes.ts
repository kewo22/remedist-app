import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { isDateOnly, isTimeOfDay, isValidPhone, normalizePhone } from '@remedist/shared';
import { ValidationFailedException } from '../exceptions/common.exceptions';

// Pipes for single route params and query values, e.g.
//   @Get(':date') list(@Param('date', ParseDateOnlyPipe) date: string)
//   @Query('time', new ParseTimeOfDayPipe({ optional: true })) time?: string
// For request bodies, use the matching DTO decorators in common/validation instead.

interface FormatPipeOptions {
  /** Let a missing value through as undefined instead of rejecting it. */
  optional?: boolean;
}

abstract class FormatPipe implements PipeTransform<unknown, string | undefined> {
  protected abstract readonly description: string;

  constructor(private readonly options: FormatPipeOptions = {}) {}

  transform(value: unknown, metadata: ArgumentMetadata): string | undefined {
    if ((value === undefined || value === '') && this.options.optional) {
      return undefined;
    }
    const parsed = typeof value === 'string' ? this.parse(value) : undefined;
    if (parsed === undefined) {
      const field = metadata.data ?? metadata.type;
      throw new ValidationFailedException([{ field, messages: [`${field} must be ${this.description}`] }]);
    }
    return parsed;
  }

  /** The accepted (possibly normalised) value, or undefined if it's invalid. */
  protected abstract parse(value: string): string | undefined;
}

@Injectable()
export class ParseDateOnlyPipe extends FormatPipe {
  protected readonly description = 'a date in YYYY-MM-DD format';
  protected parse(value: string): string | undefined {
    return isDateOnly(value) ? value : undefined;
  }
}

@Injectable()
export class ParseTimeOfDayPipe extends FormatPipe {
  protected readonly description = 'a 24-hour time in HH:MM format';
  protected parse(value: string): string | undefined {
    return isTimeOfDay(value) ? value : undefined;
  }
}

/** Returns the normalised "+<digits>" form. */
@Injectable()
export class ParsePhonePipe extends FormatPipe {
  protected readonly description = 'a phone number with country code, e.g. +94 77 123 4567';
  protected parse(value: string): string | undefined {
    const normalized = normalizePhone(value);
    return isValidPhone(normalized) ? normalized : undefined;
  }
}
