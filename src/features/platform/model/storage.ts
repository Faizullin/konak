/**
 * Storage keys for attachments.
 *
 * The key must be **random**, never derived from a row id. A passport scan at a
 * predictable path is readable by anyone who can guess an integer, whatever the
 * row's `publicId` says.
 */

const RANDOM_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Lowercased, stripped of anything a path or a header would have to escape.
 *
 * Dot runs collapse and leading separators go, so `../../etc/passwd` becomes
 * `etc-passwd` rather than a safe-but-alarming `..-..-etc-passwd`, and nothing
 * ever comes out looking like a hidden file.
 */
export function safeFileName(fileName: string): string {
  const cleaned = fileName
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 120);
  return cleaned || "file";
}

/**
 * `<scope>/<random>/<name>` — the random segment is the whole of the secrecy,
 * so the scope may be an id and the name may be the guest's own.
 */
export function newStorageKey(scope: string, fileName: string): string {
  return `${scope}/${globalThis.crypto.randomUUID()}/${safeFileName(fileName)}`;
}

/**
 * Guards against a key that was built by hand from ids. Used before a write, so
 * a predictable path never reaches the column.
 */
export function isUnguessableStorageKey(key: string): boolean {
  const parts = key.split("/");
  return parts.length >= 3 && parts.some((part) => RANDOM_SEGMENT.test(part));
}
