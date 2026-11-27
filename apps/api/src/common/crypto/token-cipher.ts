import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;

/**
 * AES-256-GCM for secrets the API must read back (third-party OAuth tokens), so a database dump
 * doesn't hand over the accounts. Stored as `v1:<iv>:<tag>:<ciphertext>`, base64 parts.
 */
export class TokenCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error('TokenCipher needs a 32-byte key');
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
  }

  /** Throws if the value was changed or made with another key. */
  decrypt(stored: string): string {
    const [version, iv, tag, ciphertext] = stored.split(':');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error('Unrecognised encrypted token format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }
}
