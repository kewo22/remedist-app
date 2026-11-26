import type { StaffLoginRequest } from '@remedist/shared';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StaffLoginDto implements StaffLoginRequest {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @MaxLength(254)
  @IsEmail()
  email!: string;

  // bcrypt only reads the first 72 bytes; the cap stops huge bodies being hashed.
  @MaxLength(200)
  @IsNotEmpty()
  @IsString()
  password!: string;
}
