import bcrypt from 'bcryptjs';

/**
 * Work factor for user-password hashing. Bumped 10 -> 12 (industry baseline for
 * 2024+). Only user passwords use this; high-entropy random tokens (refresh,
 * device, pairing) and short-lived OTPs/PINs stay at cost 10 — a higher factor
 * there would just slow every token rotation for no security gain.
 */
export const BCRYPT_COST = 12;

/** Hash a user password at the current work factor. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * True if an existing hash was made at a lower cost than BCRYPT_COST (or is
 * unparseable) — used to transparently re-hash on successful login. bcrypt
 * format is `$2a$<cost>$...`.
 */
export function needsRehash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  const m = /^\$2[aby]\$(\d{2})\$/.exec(hash);
  if (!m) return false;
  return parseInt(m[1], 10) < BCRYPT_COST;
}
