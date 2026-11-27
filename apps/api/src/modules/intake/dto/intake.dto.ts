import {
  INTAKE_FORM_VERSION,
  INTAKE_MAX_PAIN_POINTS,
  INTAKE_TEXT_MAX_LENGTH,
  POSTURE_PHOTO_SIDES,
  type IntakeAnswers,
  type IntakePainPointInput,
  type PosturePhotoSide,
  type SubmitIntakeRequest,
} from '@remedist/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, Equals, IsArray, IsIn, IsInt, IsObject, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { NullableText } from '../../contacts/dto/contact-fields';

export class PainPointDto implements IntakePainPointInput {
  @IsUUID()
  segmentId!: string;

  @IsInt()
  @Min(1)
  @Max(INTAKE_MAX_PAIN_POINTS)
  rank!: number;
}

export class SubmitIntakeDto implements SubmitIntakeRequest {
  @Equals(INTAKE_FORM_VERSION, { message: 'This form has changed. Please reload it to see the latest questions.' })
  formVersion!: typeof INTAKE_FORM_VERSION;

  /** Checked against the question set by parseIntakeAnswers (the questions live in packages/shared). */
  @IsObject()
  answers!: IntakeAnswers;

  @IsArray()
  @ArrayMaxSize(INTAKE_MAX_PAIN_POINTS, { message: `Choose up to ${INTAKE_MAX_PAIN_POINTS} pain points` })
  @ValidateNested({ each: true })
  @Type(() => PainPointDto)
  painPoints!: PainPointDto[];

  @NullableText(INTAKE_TEXT_MAX_LENGTH)
  problemDescription!: string | null;
}

export class IntakeFormParamsDto {
  @IsUUID()
  intakeId!: string;
}

export class IntakePhotoParamsDto extends IntakeFormParamsDto {
  @IsIn(POSTURE_PHOTO_SIDES)
  side!: PosturePhotoSide;
}

export class ClientIntakeParamsDto {
  @IsUUID()
  contactId!: string;
}
