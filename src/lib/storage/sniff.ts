/**
 * What a file actually is, from its first bytes — `Content-Type` is a claim the
 * client makes and `.pdf` is one the filename makes.
 *
 * Narrow on purpose: it knows the types `KIND_LIMITS` allows and answers `null`
 * for everything else, so an unrecognised file is refused rather than guessed.
 */

/** Enough for every signature below; HEIF's brand sits at offset 8. */
export const SNIFF_BYTES = 16;

function startsWith(head: Buffer, bytes: number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => head[offset + i] === byte);
}

/** HEIC and HEIF are the same container with different brands at offset 8. */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

export function sniffMimeType(head: Buffer): string | null {
  // %PDF
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";

  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";

  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";

  // RIFF....WEBP — the size sits between the two, so the second tag is at 8.
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }

  // ....ftyp<brand>
  if (startsWith(head, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = head.subarray(8, 12).toString("latin1");
    if (HEIF_BRANDS.has(brand))
      return brand === "mif1" || brand === "msf1" ? "image/heif" : "image/heic";
  }

  return null;
}
