import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { EmailProvider } from '../../integrations/email/email.provider';
import { OtpRepository } from './otp.repository';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Emails ADMIN_ALERT_EMAILS once per UTC day when the daily OTP cap trips, with the busiest
 * phones, emails and IPs. The once-a-day dedupe is in memory, so it assumes one API instance
 * (see CLAUDE.md, "In-memory state"); a second instance would at most send a second alert.
 */
@Injectable()
export class OtpCapAlertService {
  private readonly logger = new Logger(OtpCapAlertService.name);
  private lastAlertDay: string | null = null;

  constructor(
    private readonly repository: OtpRepository,
    private readonly email: EmailProvider,
    private readonly config: AppConfig,
  ) {}

  /** Never throws: an alert failure must not change the response to the caller. */
  async maybeAlert(count: number, cap: number): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastAlertDay === today) {
      return;
    }
    this.lastAlertDay = today;
    this.logger.warn(`Daily OTP send cap reached (${count}/${cap}); further codes are refused until midnight UTC`);

    const recipients = this.config.email.adminAlertEmails;
    if (recipients.length === 0) {
      this.logger.warn('No ADMIN_ALERT_EMAILS set, so nobody was emailed about the OTP cap');
      return;
    }
    try {
      const [phones, emails, ips] = await Promise.all([
        this.repository.topToday('phone_number', 5),
        this.repository.topToday('email', 5),
        this.repository.topToday('ip_address', 5),
      ]);
      const list = (title: string, rows: { value: string; count: number }[]): string =>
        rows.length === 0
          ? ''
          : `<h3>${title}</h3><ul>${rows.map((r) => `<li>${escapeHtml(r.value)}: ${r.count}</li>`).join('')}</ul>`;
      const html = `
        <div style="font-family:sans-serif;max-width:560px;">
          <h2>Daily code limit reached</h2>
          <p>${count} codes were sent today, against a cap of ${cap}. No more verification or reset codes
          will be sent until midnight UTC. This usually means someone is abusing the sign-up or reset forms.</p>
          ${list('Busiest phone numbers', phones)}${list('Busiest emails', emails)}${list('Busiest IP addresses', ips)}
          <p>Block abusers from the CRM's security panel.</p>
        </div>`;
      await Promise.all(
        recipients.map((to) => this.email.send({ to, subject: 'The Remedist: daily code limit reached', html })),
      );
    } catch (error) {
      this.logger.error('Failed to send the OTP cap alert', error instanceof Error ? error.stack : undefined);
    }
  }
}
