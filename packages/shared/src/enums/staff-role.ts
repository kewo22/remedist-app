// Roles for CRM logins (the admin_users table). Must match the CHECK constraint on
// admin_users.role in apps/api/src/database/migrations.

export const StaffRole = {
  /** Full CRM access, including owner-only settings. */
  OWNER: 'owner',
  /** CRM access without owner-only settings. */
  STAFF: 'staff',
  /** The Ask Remedist panel only. Rejected by every normal staff route. */
  ASK_REMEDIST: 'ask_remedist',
} as const;

export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];
