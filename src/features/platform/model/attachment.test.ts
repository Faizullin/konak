import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KIND_REQUIRES,
  kindsRefusedBy,
  refuseAttachment,
  refuseProviderForKind,
  refuseQuota,
  uploadByteLimit,
  uploadReleaseAt,
  UPLOAD_WINDOW_MS,
} from "./attachment";
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

test("the filesystem may hold a passport, though it signs nothing", () => {
  // The regression this exists for: requiring `signedReads` refused the one
  // provider that serves nothing publicly and checks membership on every read.
  const filesystem = { directUpload: false, privateObjects: true, signedReads: false };

  for (const kind of ATTACHMENT_KINDS) {
    assert.equal(refuseProviderForKind(filesystem, kind), null, kind);
  }
});

test("only privacy decides, so how a provider serves or receives never does", () => {
  // If either of these ever fails, a trait about *how* has been confused for a
  // rule about *may* — which is what refused the filesystem the first time.
  for (const kind of ATTACHMENT_KINDS) {
    assert.equal(KIND_REQUIRES[kind].directUpload, undefined, kind);
    assert.equal(KIND_REQUIRES[kind].signedReads, undefined, kind);
  }
});

/* --- Size and type -------------------------------------------------------- */

const PDF = { kind: "CONTRACT" as const, sizeBytes: 1000, mimeType: "application/pdf" };

test("an ordinary file passes", () => {
  assert.equal(refuseAttachment(PDF), null);
});

test("an empty file is not a file", () => {
  assert.equal(refuseAttachment({ ...PDF, sizeBytes: 0 })?.code, "attachment.empty");
});

test("the cap is per kind, not one number", () => {
  const fifteenMB = 15 * 1024 * 1024;

  // A contract may be 20 MB; an identity document may not be 15.
  assert.equal(refuseAttachment({ ...PDF, sizeBytes: fifteenMB }), null);
  assert.equal(
    refuseAttachment({ kind: "IDENTITY_DOCUMENT", sizeBytes: fifteenMB, mimeType: "image/jpeg" })
      ?.code,
    "attachment.too_large"
  );
});

test("the refusal names the cap in megabytes, not bytes", () => {
  const refusal = refuseAttachment({ ...PDF, sizeBytes: 50 * 1024 * 1024 });
  assert.equal(refusal?.values?.max, 20);
});

test("the type is an allowlist, and a contract is a PDF", () => {
  assert.equal(
    refuseAttachment({ ...PDF, mimeType: "image/jpeg" })?.code,
    "attachment.type_refused"
  );
  assert.equal(refuseAttachment({ ...PDF, kind: "FILE", mimeType: "image/jpeg" }), null);
});

test("a charset parameter is not part of the type", () => {
  // `application/pdf; charset=binary` is what some browsers send.
  assert.equal(refuseAttachment({ ...PDF, mimeType: "application/pdf; charset=binary" }), null);
  assert.equal(refuseAttachment({ ...PDF, mimeType: "APPLICATION/PDF" }), null);
});

test("an executable dressed as a PDF is refused by type", () => {
  assert.equal(
    refuseAttachment({ ...PDF, mimeType: "application/x-msdownload" })?.code,
    "attachment.type_refused"
  );
});

/* --- What may arrive against a reservation -------------------------------- */

test("the reservation caps the upload, not the kind", () => {
  // The quota was charged the claim. If the kind's cap were the bound, a
  // one-byte reservation would admit 20 MB and the quota would bound nothing.
  assert.equal(uploadByteLimit("CONTRACT", 1000), 1000);
});

test("the kind's cap still bounds a reservation that outgrew it", () => {
  assert.equal(uploadByteLimit("IDENTITY_DOCUMENT", 50 * 1024 * 1024), 10 * 1024 * 1024);
});

/* --- Quota ---------------------------------------------------------------- */

const GB = 1024 * 1024 * 1024;

test("a file that fits is not refused", () => {
  assert.equal(refuseQuota({ quotaBytes: GB, usedBytes: 0, incomingBytes: 1000 }), null);
});

test("a file that exactly fills the quota still fits", () => {
  // Off-by-one here would refuse the last legitimate upload forever.
  assert.equal(refuseQuota({ quotaBytes: GB, usedBytes: GB - 1000, incomingBytes: 1000 }), null);
});

test("one byte past is refused", () => {
  assert.equal(
    refuseQuota({ quotaBytes: GB, usedBytes: GB - 1000, incomingBytes: 1001 })?.code,
    "attachment.quota_exceeded"
  );
});

test("the refusal says how much room is left and how much was needed", () => {
  const refusal = refuseQuota({
    quotaBytes: 100 * 1024 * 1024,
    usedBytes: 98 * 1024 * 1024,
    incomingBytes: 5 * 1024 * 1024,
  });

  assert.equal(refusal?.values?.available, 2);
  assert.equal(refusal?.values?.needed, 5);
});

test("a quota lowered below what is stored reports zero free, not a negative", () => {
  const refusal = refuseQuota({ quotaBytes: 10, usedBytes: 5000, incomingBytes: 1 });
  assert.equal(refusal?.values?.available, 0);
});

/* --- The upload window ---------------------------------------------------- */

test("the reservation expires ahead of now, and the window is minutes not hours", () => {
  const now = new Date("2026-03-04T12:00:00Z");

  assert.equal(uploadReleaseAt(now).toISOString(), "2026-03-04T12:15:00.000Z");
  assert.ok(UPLOAD_WINDOW_MS < 60 * 60 * 1000);
});
