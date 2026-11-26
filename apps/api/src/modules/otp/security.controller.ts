import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Permission, type BlocklistEntry, type SecurityOverview } from '@remedist/shared';
import type { Request } from 'express';
import { CurrentUser, StaffOnly } from '../../common/auth/auth.decorators';
import { clientInfo } from '../../common/auth/client-info';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CreateBlockDto } from './dto/create-block.dto';
import { SecurityService } from './security.service';

/** CRM security panel. Routes match SECURITY_ROUTES. Owners (settings.manage), as in the old app. */
@Controller('admin/security')
@StaffOnly(Permission.SETTINGS_MANAGE)
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get('overview')
  @ResponseMessage('Security overview')
  overview(): Promise<SecurityOverview> {
    return this.security.overview();
  }

  @Get('blocklist')
  @ResponseMessage('Blocklist')
  blocklist(): Promise<BlocklistEntry[]> {
    return this.security.listBlocks();
  }

  @Post('blocklist')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Blocked.')
  block(
    @Body() body: CreateBlockDto,
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
  ): Promise<BlocklistEntry> {
    return this.security.addBlock(body, staff, clientInfo(request));
  }

  @Delete('blocklist/:id')
  @ResponseMessage('Unblocked.')
  async unblock(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
  ): Promise<null> {
    await this.security.removeBlock(id, staff, clientInfo(request));
    return null;
  }
}
