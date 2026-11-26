// CRM security panel: code-sending volume and the OTP blocklist. Staff with settings.manage.

export const SECURITY_ROUTES = {
  /** GET → SecurityOverview. */
  overview: '/admin/security/overview',
  /** GET → BlocklistEntry[] (newest 200). POST CreateBlockRequest → BlocklistEntry (201). */
  blocklist: '/admin/security/blocklist',
  /** DELETE → null. Replace :id with the entry id. */
  blocklistEntry: '/admin/security/blocklist/:id',
} as const;

export interface SendVolume {
  /** A phone number, email or IP address. */
  value: string;
  count: number;
}

export interface SecurityOverview {
  /** Codes issued in the last 24 hours. */
  sends24h: number;
  /** DAILY_OTP_SEND_CAP: codes allowed per UTC day, clinic-wide. */
  dailyCap: number;
  /** Codes issued since midnight UTC. */
  dailySendCount: number;
  /** Busiest identifiers in the last 24 hours. */
  topPhones: SendVolume[];
  topEmails: SendVolume[];
  topIps: SendVolume[];
}

export interface BlocklistEntry {
  id: string;
  phoneNumber: string | null;
  email: string | null;
  ipAddress: string | null;
  reason: string;
  /** The staff name, or a label such as 'auto: daily cap'. */
  createdByLabel: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601, or null for a permanent block. */
  expiresAt: string | null;
}

/** At least one of phoneNumber, email and ipAddress. */
export interface CreateBlockRequest {
  phoneNumber?: string;
  email?: string;
  ipAddress?: string;
  reason: string;
  /** ISO 8601, in the future. Omit for a permanent block. */
  expiresAt?: string;
}
