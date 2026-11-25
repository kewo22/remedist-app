// Staff roles and permissions. One person can hold several roles (Rauzan is owner + doctor).
// The API checks permissions, never role names. `pnpm --filter api seed` copies these into
// auth.roles and auth.role_permissions, so this file is the single source of truth.

export const Role = {
  /** The developer. Granted only by seed or CLI, never from the CRM; requires MFA. */
  SUPER_ADMIN: 'super_admin',
  /** Runs the clinic: everything except writing clinical notes and system tasks. */
  OWNER: 'owner',
  /** Treats patients. Needs a practitioner profile to be bookable. */
  DOCTOR: 'doctor',
  /** Front desk: patients, schedule, billing and content, no clinical records. */
  STAFF: 'staff',
  /** The Ask Remedist panel only. */
  ASK_REMEDIST: 'ask_remedist',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const Permission = {
  PATIENTS_MANAGE: 'patients.manage', // view and edit patient details
  CLINICAL_READ: 'clinical.read',
  CLINICAL_WRITE: 'clinical.write', // write and sign clinical records
  SCHEDULE_MANAGE: 'schedule.manage', // availability and bookings
  BILLING_MANAGE: 'billing.manage',
  CONTENT_MANAGE: 'content.manage', // FAQs, ailments, terms
  SETTINGS_MANAGE: 'settings.manage', // settings, rate card, integrations
  STAFF_MANAGE: 'staff.manage', // staff accounts and roles
  AI_ASK: 'ai.ask', // Ask Remedist
  SYSTEM_MANAGE: 'system.manage', // migrations, blocklist, security overview
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export interface RoleDefinition {
  name: string;
  description: string;
  permissions: readonly Permission[];
}

const P = Permission;

export const ROLE_DEFINITIONS: Readonly<Record<Role, RoleDefinition>> = {
  super_admin: {
    name: 'Super admin',
    description: 'System role for the developer. Clinical record access is logged.',
    permissions: [
      P.PATIENTS_MANAGE,
      P.CLINICAL_READ,
      P.SCHEDULE_MANAGE,
      P.BILLING_MANAGE,
      P.CONTENT_MANAGE,
      P.SETTINGS_MANAGE,
      P.STAFF_MANAGE,
      P.AI_ASK,
      P.SYSTEM_MANAGE,
    ],
  },
  owner: {
    name: 'Owner',
    description: 'Runs the clinic. Cannot grant super_admin or remove the last owner.',
    permissions: [
      P.PATIENTS_MANAGE,
      P.CLINICAL_READ,
      P.SCHEDULE_MANAGE,
      P.BILLING_MANAGE,
      P.CONTENT_MANAGE,
      P.SETTINGS_MANAGE,
      P.STAFF_MANAGE,
      P.AI_ASK,
    ],
  },
  doctor: {
    name: 'Doctor',
    description: 'Treats patients; the only role that writes and signs clinical records.',
    permissions: [P.PATIENTS_MANAGE, P.CLINICAL_READ, P.CLINICAL_WRITE, P.SCHEDULE_MANAGE, P.AI_ASK],
  },
  staff: {
    name: 'Staff',
    description: 'Front desk: patients, schedule, billing and content.',
    permissions: [P.PATIENTS_MANAGE, P.SCHEDULE_MANAGE, P.BILLING_MANAGE, P.CONTENT_MANAGE],
  },
  ask_remedist: {
    name: 'Ask Remedist',
    description: 'The Ask Remedist panel only.',
    permissions: [P.AI_ASK],
  },
};

/** Every permission granted by any of the given roles. */
export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  return new Set(roles.flatMap((role) => ROLE_DEFINITIONS[role].permissions));
}
