import { Injectable } from '@nestjs/common';
import { formatRegistrationNumber } from '@remedist/shared';
import type { Queryable } from '../../database/database.service';
import { ClientNotFoundException } from './contacts.exceptions';
import { ContactsRepository } from './contacts.repository';

/**
 * The permanent client number (REM-0001...), assigned once at Part 1 completion, for paid and
 * pro-bono clients alike. Part 1 calls `assign` inside its own transaction, so the number and
 * part1_completed_at commit or roll back together (the old app's fix for a dead end where Part 1
 * was complete but no number was set).
 */
@Injectable()
export class RegistrationNumberService {
  constructor(private readonly contacts: ContactsRepository) {}

  /** Idempotent: a contact that already has a number keeps it, and no sequence value is drawn. */
  async assign(contactId: string, tx: Queryable): Promise<string> {
    const contact = await this.contacts.findByIdForUpdate(contactId, tx);
    if (!contact) {
      throw new ClientNotFoundException();
    }
    if (contact.registration_number) {
      return contact.registration_number;
    }
    const sequence = await this.contacts.nextRegistrationSequence(tx);
    const assigned = await this.contacts.setRegistrationNumberIfUnset(contactId, formatRegistrationNumber(sequence), tx);
    if (!assigned) {
      throw new Error(`Registration number not set for contact ${contactId}`);
    }
    return assigned;
  }
}
