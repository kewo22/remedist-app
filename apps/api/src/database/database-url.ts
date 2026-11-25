// pg 8 treats these as verify-full (and warns); pg 9 will downgrade them to libpq's weaker
// meaning. `neon env pull` writes sslmode=require, so pin verify-full here: Neon serves
// publicly trusted certificates, so the full check always passes.
const SSL_MODES_TO_PIN = new Set(['prefer', 'require', 'verify-ca']);

export function withFullTlsVerification(connectionString: string): string {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode && SSL_MODES_TO_PIN.has(sslmode)) {
    url.searchParams.set('sslmode', 'verify-full');
  }
  return url.toString();
}
