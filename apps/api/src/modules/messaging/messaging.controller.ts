import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Permission, type MessageLogEntry } from '@remedist/shared';
import { StaffOnly } from '../../common/auth/auth.decorators';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ClientNotFoundException } from '../contacts/contacts.exceptions';
import { ContactsRepository } from '../contacts/contacts.repository';
import { MessagingService } from './messaging.service';

/** The messages a client was sent, in the CRM. ADMIN_MESSAGE_ROUTES. */
@Controller('admin/clients')
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly contacts: ContactsRepository,
  ) {}

  @Get(':id/messages')
  @StaffOnly(Permission.PATIENTS_MANAGE)
  @ResponseMessage('Messages')
  async forClient(@Param('id', ParseUUIDPipe) id: string): Promise<MessageLogEntry[]> {
    if (!(await this.contacts.findById(id))) {
      throw new ClientNotFoundException();
    }
    return this.messaging.listForContact(id);
  }
}
