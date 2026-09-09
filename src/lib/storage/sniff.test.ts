import assert from "node:assert/strict";
import { test } from "node:test";
import { sniffMimeType, SNIFF_BYTES } from "./sniff";

/** A head of the right length, from the bytes that identify the format. */
function head(...bytes: (number | string)[]): Buffer {
  const flat = bytes.flatMap((b) => (typeof b === "string" ? [...Buffer.from(b, "latin1")] : [b]));
  const buffer = Buffer.alloc(SNIFF_BYTES);
  Buffer.from(flat).copy(buffer);
  return buffer;
}

test("a PDF is recognised by its header, not its extension", () => {
  assert.equal(sniffMimeType(head("%PDF-1.7")), "application/pdf");
});

test("JPEG and PNG", () => {
  assert.equal(sniffMimeType(head(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(sniffMimeType(head(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
});

test("WEBP needs both tags, so RIFF alone is not enough", () => {
  assert.equal(sniffMimeType(head("RIFF", 0, 0, 0, 0, "WEBP")), "image/webp");
  assert.equal(sniffMimeType(head("RIFF", 0, 0, 0, 0, "WAVE")), null);
});

test("HEIC, because that is what a phone photographs a passport with", () => {
  assert.equal(sniffMimeType(head(0, 0, 0, 0x18, "ftyp", "heic")), "image/heic");
  assert.equal(sniffMimeType(head(0, 0, 0, 0x18, "ftyp", "mif1")), "image/heif");
});

test("an unknown format is null, never a guess", () => {
  assert.equal(sniffMimeType(head("MZ", 0x90, 0x00)), null);
  assert.equal(sniffMimeType(head("<html>")), null);
});

test("a truncated head does not throw or match", () => {
  assert.equal(sniffMimeType(Buffer.alloc(0)), null);
  assert.equal(sniffMimeType(Buffer.from([0x25, 0x50])), null);
});

test("an executable renamed .pdf is still an executable", () => {
  // The whole point: the name and the Content-Type both said PDF.
  assert.notEqual(sniffMimeType(head("MZ", 0x90)), "application/pdf");
});
