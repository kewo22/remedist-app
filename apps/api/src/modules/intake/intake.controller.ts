import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  INTAKE_PHOTO_MAX_BYTES,
  Permission,
  type AnatomySegment,
  type ClientContactProfile,
  type IntakeForm,
  type IntakeFormSummary,
  type IntakePhoto,
  type IntakePrefill,
  type TopNationalities,
} from '@remedist/shared';
import type { Request } from 'express';
import { ClientSignedIn, CurrentClient, CurrentUser, PublicRoute, StaffOnly } from '../../common/auth/auth.decorators';
import { clientInfo } from '../../common/auth/client-info';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { ProfileQueryDto } from '../contacts/dto/portal-profile.dto';
import { ClientIntakeParamsDto, IntakeFormParamsDto, IntakePhotoParamsDto, SubmitIntakeDto } from './dto/intake.dto';
import { CompletePart1Dto } from './dto/part1.dto';
import { IntakeFormsService, type UploadedPhoto } from './intake-forms.service';
import { Part1Service } from './part1.service';

/** Reference lists for the intake forms. PUBLIC_INTAKE_ROUTES. */
@Controller('public/intake')
@PublicRoute()
export class PublicIntakeController {
  constructor(
    private readonly part1: Part1Service,
    private readonly forms: IntakeFormsService,
  ) {}

  @Get('nationalities')
  @ResponseMessage('Most common nationalities')
  async nationalities(): Promise<TopNationalities> {
    return { topNationalities: await this.part1.topNationalities() };
  }

  @Get('anatomy-segments')
  @ResponseMessage('Body areas')
  anatomySegments(): Promise<AnatomySegment[]> {
    return this.forms.anatomySegments();
  }
}

/** Part 1 and Part 2 for the signed-in client and their dependents. PORTAL_INTAKE_ROUTES. */
@Controller('portal/intake')
@ClientSignedIn()
export class PortalIntakeController {
  constructor(
    private readonly part1: Part1Service,
    private readonly forms: IntakeFormsService,
  ) {}

  @Post('part1')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Registration complete')
  completePart1(
    @CurrentClient() client: CurrentClientAccount,
    @Body() body: CompletePart1Dto,
    @Req() request: Request,
  ): Promise<ClientContactProfile> {
    return this.part1.complete(client, body, clientInfo(request));
  }

  @Get('forms')
  @ResponseMessage('Intake forms')
  list(@CurrentClient() client: CurrentClientAccount, @Query() query: ProfileQueryDto): Promise<IntakeFormSummary[]> {
    return this.forms.listForClient(client, query.contactId);
  }

  @Get('prefill')
  @ResponseMessage('Answers from your last visit')
  prefill(@CurrentClient() client: CurrentClientAccount, @Query() query: ProfileQueryDto): Promise<IntakePrefill | null> {
    return this.forms.prefillForClient(client, query.contactId);
  }

  @Get('forms/:intakeId')
  @ResponseMessage('Intake form')
  get(@CurrentClient() client: CurrentClientAccount, @Param() params: IntakeFormParamsDto): Promise<IntakeForm> {
    return this.forms.getForClient(client, params.intakeId);
  }

  @Put('forms/:intakeId')
  @ResponseMessage('Thank you. Your intake form is saved.')
  submit(
    @CurrentClient() client: CurrentClientAccount,
    @Param() params: IntakeFormParamsDto,
    @Body() body: SubmitIntakeDto,
    @Req() request: Request,
  ): Promise<IntakeForm> {
    return this.forms.submitForClient(client, params.intakeId, body, clientInfo(request));
  }

  @Put('forms/:intakeId/photos/:side')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: INTAKE_PHOTO_MAX_BYTES, files: 1, fields: 0 } }))
  @ResponseMessage('Photo saved')
  uploadPhoto(
    @CurrentClient() client: CurrentClientAccount,
    @Param() params: IntakePhotoParamsDto,
    @UploadedFile() file: UploadedPhoto | undefined,
    @Req() request: Request,
  ): Promise<IntakePhoto> {
    return this.forms.uploadPhotoForClient(client, params.intakeId, params.side, file, clientInfo(request));
  }
}

/**
 * Intake in the CRM: owners and doctors view (clinical.read), doctors enter the on-site paper form
 * (clinical.write). Every access is written to clinical.access_log. ADMIN_INTAKE_ROUTES.
 */
@Controller('admin')
export class AdminIntakeController {
  constructor(private readonly forms: IntakeFormsService) {}

  @Get('clients/:contactId/intake-forms')
  @StaffOnly(Permission.CLINICAL_READ)
  @ResponseMessage('Intake forms')
  list(
    @CurrentUser() staff: CurrentStaff,
    @Param() params: ClientIntakeParamsDto,
    @Req() request: Request,
  ): Promise<IntakeFormSummary[]> {
    return this.forms.listForStaff(staff, params.contactId, clientInfo(request));
  }

  @Get('clients/:contactId/intake-prefill')
  @StaffOnly(Permission.CLINICAL_READ)
  @ResponseMessage('Answers from the last visit')
  prefill(
    @CurrentUser() staff: CurrentStaff,
    @Param() params: ClientIntakeParamsDto,
    @Req() request: Request,
  ): Promise<IntakePrefill | null> {
    return this.forms.prefillForStaff(staff, params.contactId, clientInfo(request));
  }

  @Get('intake-forms/:intakeId')
  @StaffOnly(Permission.CLINICAL_READ)
  @ResponseMessage('Intake form')
  get(@CurrentUser() staff: CurrentStaff, @Param() params: IntakeFormParamsDto, @Req() request: Request): Promise<IntakeForm> {
    return this.forms.getForStaff(staff, params.intakeId, clientInfo(request));
  }

  @Put('intake-forms/:intakeId')
  @StaffOnly(Permission.CLINICAL_WRITE)
  @ResponseMessage('Intake form saved')
  submit(
    @CurrentUser() staff: CurrentStaff,
    @Param() params: IntakeFormParamsDto,
    @Body() body: SubmitIntakeDto,
    @Req() request: Request,
  ): Promise<IntakeForm> {
    return this.forms.submitForStaff(staff, params.intakeId, body, clientInfo(request));
  }

  /** The image itself. Never cached: it's clinical data. */
  @Get('intake-forms/:intakeId/photos/:side')
  @StaffOnly(Permission.CLINICAL_READ)
  @SkipEnvelope()
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async photo(
    @CurrentUser() staff: CurrentStaff,
    @Param() params: IntakePhotoParamsDto,
    @Req() request: Request,
  ): Promise<StreamableFile> {
    const file = await this.forms.photoForStaff(staff, params.intakeId, params.side, clientInfo(request));
    return new StreamableFile(file.body, { type: file.contentType, disposition: 'inline', length: file.body.length });
  }
}
