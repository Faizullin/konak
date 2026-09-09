import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env.mjs";

/**
 * Field-level encryption, for the columns that hold something the database
 * alone should not reveal — a passport number today, a payment reference later.
 *
 * Relative import of `env.mjs`, like `db.ts`: this sits on the path
 * `auth:generate` loads through jiti, which does not read tsconfig `paths`.
 *
 * **AES-256-GCM**, so a modified ciphertext fails to decrypt rather than
 * decrypting to something else. That matters more here than speed: a passport
 * number that silently changed is worse than one that could not be read.
 *
 * **Not deterministic.** The same number encrypts differently every time, so
 * `WHERE numberEncrypted = ?` cannot work and is not meant to. Finding a
 * document is what `numberLast4` is for; equality on a ciphertext would leak
 * which guests share a document anyway.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The envelope is versioned so the algorithm or the key can change without
 * guessing at what old rows contain: a v2 reader knows a `v1.` row is v1.
 */
const VERSION = "v1";

/** Decoded once. A malformed key is a startup failure, not a per-write surprise. */
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;

  const decoded = Buffer.from(env.FIELD_ENCRYPTION_KEY, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `FIELD_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${decoded.length}. ` +
        `Generate one with: openssl rand -base64 32`
    );
  }

  cachedKey = decoded;
  return decoded;
}

/**
 * `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 *
 * One string in one column, rather than three columns: the parts are useless
 * apart, and a schema that could hold an IV without its ciphertext is a schema
 * that will eventually hold one.
 */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Throws on anything that is not exactly what `encryptField` produced with this
 * key — a truncated envelope, a flipped bit, the wrong key. Deliberately not a
 * `null` return: a caller that forgot to check would write the absence of a
 * passport number into an official filing.
 */
export function decryptField(envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Not an encrypted field, or a version this build cannot read");
  }

  const iv = Buffer.from(parts[1]!, "base64url");
  const tag = Buffer.from(parts[2]!, "base64url");
  const ciphertext = Buffer.from(parts[3]!, "base64url");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Encrypted field is malformed");
  }

  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  // `final()` is what raises on a bad tag; without it a truncated ciphertext
  // would return whatever decrypted before the end.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Whether a value is already an envelope this build wrote.
 *
 * The guard against the failure the column is named for: a writer that stores
 * a number in clear produces a value this answers `false` to, and a check at
 * the boundary can refuse it.
 */
export function isEncryptedField(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return false;
  return (
    Buffer.from(parts[1]!, "base64url").length === IV_BYTES &&
    Buffer.from(parts[2]!, "base64url").length === TAG_BYTES
  );
}

/**
 * The tail a receptionist confirms a document by, without the system revealing
 * it. Fewer than four characters yields what there is rather than padding —
 * padding would imply a longer number than the guest gave.
 */
export function lastFour(value: string): string {
  return value.slice(-4);
}

/**
 * Compare two secrets without leaking which character differed.
 *
 * Length is compared first and in the clear: it is not the secret, and
 * `timingSafeEqual` throws on a length mismatch rather than returning false.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
