/**
 * API key generation & verification.
 *
 * Format: dgtlz_live_<32 bytes base62>
 * Storage: HMAC-SHA256(key, API_KEY_HASH_SECRET) — keyed hashing so a DB
 * leak alone is not sufficient to verify guessed keys.
 * Full key is shown exactly once at creation; only prefix + hash are stored.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX = "dgtlz_live_";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const bytes = randomBytes(32);
  let key = PREFIX;
  for (let i = 0; i < bytes.length; i++) {
    key += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return {
    key, // shown once
    prefix: key.slice(0, PREFIX.length + 8), // masked display
    hash: hashApiKey(key),
  };
}

export function hashApiKey(key: string, secret: string): string {
  if (!secret || secret.includes("change-me")) {
    throw new Error("API_KEY_HASH_SECRET must be set to a real secret");
  }
  return createHmac("sha256", secret).update(key).digest("hex");
}

/** Constant-time comparison of a presented key against a stored hash. */
export function verifyApiKey(presented: string, storedHash: string, secret: string): boolean {
  const presentedHash = Buffer.from(hashApiKey(presented, secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (presentedHash.length !== stored.length) return false;
  return timingSafeEqual(presentedHash, stored);
}

/** Extract bearer key from an Authorization header value. */
export function extractBearerKey(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

export function isDgtlzKey(key: string): boolean {
  return key.startsWith(PREFIX) && key.length === PREFIX.length + 32;
}
