import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Checks Twilio's X-Twilio-Signature on a form-encoded webhook: base64 HMAC-SHA1, keyed by the
 * auth token, of the full URL Twilio called followed by every POST parameter (sorted by name,
 * name then value). https://www.twilio.com/docs/usage/security#validating-requests
 */
export function isValidTwilioSignature(
  authToken: string,
  url: string,
  params: Readonly<Record<string, unknown>>,
  signature: string | undefined,
): boolean {
  if (!signature) {
    return false;
  }
  let data = url;
  for (const name of Object.keys(params).sort()) {
    const value = params[name];
    const values = Array.isArray(value) ? [...(value as unknown[])].map(String).sort() : [String(value)];
    for (const each of values) {
      data += name + each;
    }
  }
  const expected = createHmac('sha1', authToken).update(data, 'utf8').digest();
  const given = Buffer.from(signature, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
