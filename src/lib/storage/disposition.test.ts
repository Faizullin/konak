import assert from "node:assert/strict";
import { test } from "node:test";
import { contentDisposition } from "./disposition";

test("a plain name keeps its spaces, rather than arriving percent-encoded", () => {
  // The bug this replaced: the file saved as `Marketing%20Consent.pdf`.
  const header = contentDisposition("Marketing Consent.pdf", false);

  assert.match(header, /filename="Marketing Consent\.pdf"/);
  assert.match(header, /filename\*=UTF-8''Marketing%20Consent\.pdf/);
});

test("inline and attachment are the only two dispositions", () => {
  assert.match(contentDisposition("a.pdf", true), /^inline;/);
  assert.match(contentDisposition("a.pdf", false), /^attachment;/);
});

test("a non-ASCII name survives in the starred form and is replaced in the plain one", () => {
  const header = contentDisposition("Ünal — passport.pdf", false);

  assert.match(header, /filename="_nal _ passport\.pdf"/);
  assert.ok(header.includes(`filename*=UTF-8''${encodeURIComponent("Ünal — passport.pdf")}`));
});

test("a quote cannot end the quoted form early", () => {
  const header = contentDisposition('evil".pdf', false);
  assert.match(header, /filename="evil_\.pdf"/);
});

test("a newline cannot inject a second header", () => {
  const header = contentDisposition("a\r\nX-Evil: 1.pdf", false);
  assert.ok(!header.includes("\n") && !header.includes("\r"));
});
