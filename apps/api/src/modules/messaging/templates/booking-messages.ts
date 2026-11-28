import { CLINIC_TIME_ZONE } from '@remedist/shared';
import type { EmailContent } from '../messaging.service';
import type { PhoneMessage } from '../../../integrations/messaging/phone-templates';
import { CLINIC_SIGN_OFF, emailLayout, escapeHtml } from './email-layout';

export interface BookingMessageDetails {
  clientName: string;
  start: Date;
  /** Null only for a booking made before codes existed. */
  appointmentCode: string | null;
}

export interface ClientMessage {
  template: 'booking_confirmed' | 'booking_rescheduled' | 'booking_cancelled';
  phone: PhoneMessage;
  email: EmailContent;
}

/** "Tue 2 Dec, 10:00", clinic time. */
export function sessionTimeLabel(start: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(start);
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there';
}

export function bookingConfirmedMessage(details: BookingMessageDetails): ClientMessage {
  const name = firstName(details.clientName);
  const when = sessionTimeLabel(details.start);
  const code = details.appointmentCode ?? '-';
  return {
    template: 'booking_confirmed',
    phone: {
      template: 'booking_confirmed',
      variables: [name, when, code],
      text: `Hi ${name}, your session with The Remedist is confirmed for ${when}. Appointment code: ${code}. See you then!`,
    },
    email: {
      subject: 'Your session is confirmed — The Remedist',
      html: emailLayout(`
        <h2>Hi ${escapeHtml(name)},</h2>
        <p>Your session is confirmed for <strong>${escapeHtml(when)}</strong>.</p>
        <p>Appointment code: <strong>${escapeHtml(code)}</strong></p>
        <p>See you then — ${CLINIC_SIGN_OFF}</p>`),
    },
  };
}

export function bookingRescheduledMessage(details: BookingMessageDetails): ClientMessage {
  const name = firstName(details.clientName);
  const when = sessionTimeLabel(details.start);
  const code = details.appointmentCode ?? '-';
  return {
    template: 'booking_rescheduled',
    phone: {
      template: 'booking_rescheduled',
      variables: [name, when, code],
      text: `Hi ${name}, your session with The Remedist has moved to ${when}. New appointment code: ${code}.`,
    },
    email: {
      subject: 'Your session has moved — The Remedist',
      html: emailLayout(`
        <h2>Hi ${escapeHtml(name)},</h2>
        <p>Your session has moved to <strong>${escapeHtml(when)}</strong>.</p>
        <p>New appointment code: <strong>${escapeHtml(code)}</strong></p>
        <p>See you then — ${CLINIC_SIGN_OFF}</p>`),
    },
  };
}

export function bookingCancelledMessage(details: BookingMessageDetails): ClientMessage {
  const name = firstName(details.clientName);
  const when = sessionTimeLabel(details.start);
  return {
    template: 'booking_cancelled',
    phone: {
      template: 'booking_cancelled',
      variables: [name, when],
      text: `Hi ${name}, your session with The Remedist on ${when} has been cancelled. Contact us to book another time.`,
    },
    email: {
      subject: 'Your session has been cancelled — The Remedist',
      html: emailLayout(`
        <h2>Hi ${escapeHtml(name)},</h2>
        <p>Your session on <strong>${escapeHtml(when)}</strong> has been cancelled.</p>
        <p>Contact us or sign in to the portal to book another time. — ${CLINIC_SIGN_OFF}</p>`),
    },
  };
}
