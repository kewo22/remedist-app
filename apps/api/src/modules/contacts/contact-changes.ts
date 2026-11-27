import type { ContactRow, ContactUpdate } from './contacts.repository';

/** Column → the contract's field name, so audit before/after reads like the API. */
const FIELD_NAMES: Record<keyof ContactUpdate, string> = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  stage: 'stage',
  gender: 'gender',
  nationality: 'nationality',
  residency: 'residency',
  id_type: 'idType',
  id_number: 'idNumber',
  date_of_birth: 'dateOfBirth',
  profession: 'profession',
  address: 'address',
  backup_contact_name: 'backupContactName',
  backup_contact_relation: 'backupContactRelation',
  backup_contact_phone: 'backupContactPhone',
  referred_by_contact_id: 'referredByContactId',
  pay_after_session: 'payAfterSession',
  reminder_frequency_days: 'reminderFrequencyDays',
};

export interface ContactChanges {
  /** Only the columns whose value actually changes. */
  update: ContactUpdate;
  /** The same, keyed by contract field name, for audit_log. */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changed: boolean;
}

/** Compares the requested values with the current row and keeps only real changes. */
export function contactChanges(current: ContactRow, requested: ContactUpdate): ContactChanges {
  const update: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(requested) as [keyof ContactUpdate, unknown][]) {
    if (value === undefined || current[column] === value) {
      continue;
    }
    update[column] = value;
    before[FIELD_NAMES[column]] = current[column];
    after[FIELD_NAMES[column]] = value;
  }
  return { update: update as ContactUpdate, before, after, changed: Object.keys(update).length > 0 };
}
