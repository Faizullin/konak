import assert from "node:assert/strict";
import { test } from "node:test";
import { KIND_REQUIRES, kindsRefusedBy, refuseProviderForKind } from "./attachment";
import { ATTACHMENT_KINDS } from "./schemas";

/** What S3 and the filesystem both offer: privacy. */
const PRIVATE = { directUpload: true, privateObjects: true, signedReads: true };
/** What Cloudinary and Vercel Blob offer by default: a public CDN. */
const PUBLIC = { directUpload: true, privateObjects: false, signedReads: true };

test("every kind is answered", () => {
  // A kind added to the enum and forgotten here would read as `undefined` and
  // require nothing — the failure mode that lets a new sensitive kind through.
  assert.deepEqual(Object.keys(KIND_REQUIRES).sort(), [...ATTACHMENT_KINDS].sort());
});

test("a private provider holds anything", () => {
  for (const kind of ATTACHMENT_KINDS) {
    assert.equal(refuseProviderForKind(PRIVATE, kind), null, kind);
  }
});

test("a public provider is refused everything but an ordinary file", () => {
  assert.equal(refuseProviderForKind(PUBLIC, "FILE"), null);
  assert.deepEqual(kindsRefusedBy(PUBLIC).sort(), ["CONSENT", "CONTRACT", "IDENTITY_DOCUMENT"]);
});

test("an identity document also needs links that expire", () => {
  const noSigning = { directUpload: false, privateObjects: true, signedReads: false };

  assert.equal(refuseProviderForKind(noSigning, "CONTRACT"), null);
  assert.equal(
    refuseProviderForKind(noSigning, "IDENTITY_DOCUMENT")?.code,
    "attachment.provider_unsigned"
  );
});

test("privacy is refused before signing, so the message names the worse fault", () => {
  const neither = { directUpload: true, privateObjects: false, signedReads: false };

  assert.equal(
    refuseProviderForKind(neither, "IDENTITY_DOCUMENT")?.code,
    "attachment.provider_public"
  );
});

test("direct upload never decides anything", () => {
  // The filesystem cannot do it and is still the safest provider here. If this
  // ever fails, a performance trait has been confused for a security one.
  for (const kind of ATTACHMENT_KINDS) {
    assert.equal(KIND_REQUIRES[kind].directUpload, undefined, kind);
  }
});
