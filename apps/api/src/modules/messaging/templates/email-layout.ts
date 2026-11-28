// The shared frame for client emails. Anything a person typed (names, notes) must go through
// escapeHtml before it's put in a template.

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function emailLayout(body: string): string {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">${body}</div>`;
}

export function codeBlock(code: string): string {
  return `<p style="font-size:28px;letter-spacing:6px;font-weight:700;">${code}</p>`;
}

export const CLINIC_SIGN_OFF = 'The Remedist, No 70/1, Ward Place, Colombo 07.';
