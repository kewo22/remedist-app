// Tunable values for availability. The shared limits (cutoff, durations, ranges) are in
// packages/shared so the CRM and booking forms agree.

/** audit_log entity types and actions written by this domain. */
export const SLOT_ENTITY = 'availability_slot';
export const SESSION_TYPE_ENTITY = 'session_type';

export const SLOT_AUDIT_ACTION = {
  created: 'slot.created',
  updated: 'slot.updated',
  blocked: 'slot.blocked',
  unblocked: 'slot.unblocked',
  deleted: 'slot.deleted',
  flagCleared: 'slot.flag_cleared',
} as const;

export const SESSION_TYPE_AUDIT_ACTION = {
  created: 'session_type.created',
  updated: 'session_type.updated',
  retired: 'session_type.retired',
  restored: 'session_type.restored',
} as const;

/** A session type's name. */
export const SESSION_TYPE_NAME_MAX_LENGTH = 80;
/** A block reason, shown in the CRM (and, with Google Calendar, as the event title). */
export const BLOCK_REASON_MAX_LENGTH = 200;
