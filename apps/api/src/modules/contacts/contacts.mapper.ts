import type {
  ClientContactProfile,
  ClientListItem,
  ClientLookupItem,
  DependentSummary,
} from '@remedist/shared';
import type { ContactListRow, ContactLookupRow, ContactRow, DependentRow } from './contacts.repository';

// Database rows → contract shapes. Timestamps become ISO strings.

export function toLookup(row: ContactLookupRow): ClientLookupItem {
  return { id: row.id, name: row.name, registrationNumber: row.registration_number };
}

export function toListItem(row: ContactListRow): ClientListItem {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    registrationNumber: row.registration_number,
    stage: row.stage,
    source: row.source,
    hasAccount: row.has_account,
    payAfterSession: row.pay_after_session,
    archived: row.archived_at !== null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toDependentSummary(row: DependentRow): DependentSummary {
  return {
    contactId: row.id,
    name: row.name,
    relationship: row.relationship,
    registrationNumber: row.registration_number,
    part1Completed: row.part1_completed_at !== null,
  };
}

export function toClientProfile(row: ContactRow, isDependent: boolean): ClientContactProfile {
  return {
    contactId: row.id,
    registrationNumber: row.registration_number,
    part1Completed: row.part1_completed_at !== null,
    isDependent,
    name: row.name,
    gender: row.gender,
    nationality: row.nationality,
    idType: row.id_type,
    idNumber: row.id_number,
    dateOfBirth: row.date_of_birth,
    email: row.email,
    phone: row.phone,
    profession: row.profession,
    address: row.address,
    backupContactName: row.backup_contact_name,
    backupContactRelation: row.backup_contact_relation,
    backupContactPhone: row.backup_contact_phone,
  };
}
