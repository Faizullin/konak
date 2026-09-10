/**
 * The `Content-Disposition` header for a stored file.
 *
 * Beside `sniff.ts` for the same reason: a fact about handing bytes to a
 * browser, vendor-neutral, and knowing no business rule. Which files may be
 * shown inline is a domain question and lives in
 * `platform/model/attachment.ts`; this only formats the answer.
 */

/**
 * RFC 6266, both halves.
 *
 * `filename=` must be ASCII, so percent-encoding a name into it saves
 * `Marketing Consent.pdf` as `Marketing%20Consent.pdf` — which is exactly what
 * this route did before. The quoted form carries a stripped fallback for old
 * agents, and `filename*` carries the real name for everything from this
 * decade.
 */
export function contentDisposition(fileName: string, inline: boolean): string {
  // A quote or a backslash inside the quoted form would end it early, and a
  // newline would let a caller inject a second header.
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(fileName);

  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
