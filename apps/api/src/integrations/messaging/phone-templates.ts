/**
 * The WhatsApp/SMS messages the clinic starts. WhatsApp only delivers a business-initiated message
 * through a template Meta has approved, so each one is created in Twilio's Content Template Builder
 * and its Content SID set in the matching TWILIO_CONTENT_SID_* variable. SMS sends the plain text.
 *
 * Variables are positional ({{1}}, {{2}}...), in the order listed here. A template's text in Twilio
 * must use them in this order.
 *
 * - verification_code (category: Authentication): {{1}} the code. Used for phone verification and
 *   password reset codes.
 * - booking_confirmed (Utility): {{1}} first name, {{2}} session time ("Tue 2 Dec, 10:00"),
 *   {{3}} appointment code.
 * - booking_rescheduled (Utility): {{1}} first name, {{2}} new session time, {{3}} new appointment code.
 * - booking_cancelled (Utility): {{1}} first name, {{2}} the cancelled session's time.
 */
export const PHONE_TEMPLATES = ['verification_code', 'booking_confirmed', 'booking_rescheduled', 'booking_cancelled'] as const;
export type PhoneTemplate = (typeof PHONE_TEMPLATES)[number];

/** One WhatsApp/SMS message: the template and its variables for WhatsApp, the full text for SMS. */
export interface PhoneMessage {
  template: PhoneTemplate;
  variables: readonly string[];
  text: string;
}
