import {
  BOOKING_LIST_MAX_PAGE_SIZE,
  BOOKING_STATUSES,
  PAYMENT_MODES,
  type AdminBookingQuery,
  type BookingStatus,
  type CancelBookingRequest,
  type CreateBookingRequest,
  type PaymentMode,
  type RescheduleRequest,
  type StaffCreateBookingRequest,
  type UpdateStaffNotesRequest,
} from '@remedist/shared';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { IsDateOnly } from '../../../common/validation/validation.decorators';
import { NullableText } from '../../contacts/dto/contact-fields';
import { BOOKING_NOTES_MAX_LENGTH } from '../bookings.constants';

export class CreateBookingDto implements CreateBookingRequest {
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsUUID()
  slotId!: string;

  @NullableText(BOOKING_NOTES_MAX_LENGTH)
  notes?: string | null;

  @IsOptional()
  @IsIn(PAYMENT_MODES)
  paymentChoice?: PaymentMode;
}

export class RescheduleDto implements RescheduleRequest {
  @IsUUID()
  slotId!: string;
}

export class StaffCreateBookingDto implements StaffCreateBookingRequest {
  @IsUUID()
  contactId!: string;

  @IsUUID()
  slotId!: string;

  @NullableText(BOOKING_NOTES_MAX_LENGTH)
  staffNotes?: string | null;

  @IsOptional()
  @IsBoolean()
  overrideLockoutWarning?: boolean;
}

export class CancelBookingDto implements CancelBookingRequest {
  @NullableText(500)
  reason?: string | null;
}

export class UpdateStaffNotesDto implements UpdateStaffNotesRequest {
  /** Null, empty or missing clears them. */
  @NullableText(BOOKING_NOTES_MAX_LENGTH)
  staffNotes!: string | null;
}

export class AdminBookingQueryDto implements AdminBookingQuery {
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;

  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(BOOKING_LIST_MAX_PAGE_SIZE)
  pageSize?: number;
}

export class BookingParamsDto {
  @IsUUID()
  bookingId!: string;
}
