import { Injectable } from '@nestjs/common';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import { ContactNotOwnedException } from './contacts.exceptions';
import { ContactRow, ContactsRepository } from './contacts.repository';

export interface OwnedContact {
  contact: ContactRow;
  /** False for the account holder's own contact. */
  isDependent: boolean;
}

/**
 * Which contacts a signed-in client may act for: their own, or one of their dependents. Profile,
 * Part 1, booking and pro-bono all go through this, so a client can never touch someone else's
 * record. (The old app's assertOwnedContact.)
 */
@Injectable()
export class ContactAccessService {
  constructor(private readonly contacts: ContactsRepository) {}

  /** `contactId` defaults to the account holder. Anyone else's contact is FORBIDDEN. */
  async requireOwned(client: CurrentClientAccount, contactId?: string): Promise<OwnedContact> {
    const owned = await this.contacts.findOwned(client.id, client.contactId, contactId ?? client.contactId);
    if (!owned) {
      throw new ContactNotOwnedException();
    }
    return owned;
  }
}
