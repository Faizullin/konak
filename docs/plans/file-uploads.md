# File uploads

The `Attachment` table records files that do not exist. This is what it would
take for them to.

**Phase 1 has landed: the classes exist, the bytes do not.** `lib/storage/` now
holds the base class, all four adapters and the registry; `env.mjs` selects one
and validates only its variables; `platform/model/attachment.ts` decides which
kinds a provider may hold. Every method that would actually move bytes throws
`StorageNotImplementedError`. What is left is below, under
[What is still missing](#what-is-still-missing) — the SDKs, the two procedures,
the migration and the route handler.

## The state of it

`platform.createAttachment` writes a row and calls `newStorageKey` to invent a
path. Nothing ever puts anything at that path. There is **no bucket, no disk
path, no SDK and no upload endpoint**. (`env.mjs` has variables now; the SDKs
and the endpoint are still absent.)

Worse than absent: `fileName`, `mimeType` and `sizeBytes` are all supplied by
the caller and never checked against anything. A row can claim a 2 KB PDF and
correspond to nothing at all.

What *was* built first is the part that is easy to get wrong, and it was already right.
`platform/model/storage.ts` makes a key unguessable, strips a filename back to
something safe, and refuses a key built from ids — `architecture.md` lists that
last one among the invariants: *"A passport scan at a path built from integers
is readable by anyone who can count."*

So the gap is the transport and the storage, not the naming.

## Where the product needs it

Four are in the schema already, and one is missing from it:

- **Identity documents.** `IdentityDocument.attachmentId` — a passport or ID
  scan. Phase 9, and the highest-risk file in the product: it is the reason
  `encryptField` exists and the reason `purgeAfter` does.
- **Consents.** `Attachment.kind = CONSENT`, with `signedAt` and `revokedAt`
  beside it. A signed marketing consent is evidence, and evidence that cannot be
  produced is not evidence.
- **Contracts.** `Attachment.companyId` — a corporate rate agreement, which is
  what a negotiated price is justified by when someone asks.
- **Anything else on a person, company or property.** The generic `FILE` kind.
- **Room type photographs, which the schema does not yet have.** `RoomType`
  carries `name`, `code` and `description` and no images. A public booking page
  cannot sell a room nobody can see, so Phase 8 needs this and the column does
  not exist. Worth deciding before the widget, not during it.

And two that are the same storage in the other direction — the system *writes* a
file rather than receiving one:

- **Folio and invoice PDFs** (Phase 6), which must still be readable years later.
- **Fiscal receipts** (Phase 9), where the archived document may be the legally
  binding artefact rather than the row.

## The shape: one interface, four providers

`../picky-screen/web_backend` is the nearest precedent and it got two things
right and one thing half-right, which is a useful place to start.

Right: **one choke point.** `features/attachments/server/create.ts` says
*"the one path from bytes to an `Attachment` row — written inline in three
places before this existed, so a change to how files are stored had three
places to reach."* Right again: the row carries `provider` and `providerId`, so
it records *which* system holds the bytes and under *what name there*.

Half-right: the provider is Cloudinary, hard-coded, and the columns that
anticipate a second one have only ever held `"cloudinary"`. The abstraction is a
column without an interface behind it.

### The interface

**Written — read `src/lib/storage/provider.ts` rather than a copy here.** An
adapter in `lib/`, by the architecture's own test: it knows no business rule and
would be swapped whole.

Two things changed between this plan and the code, both worth knowing:

- `can` became **`capabilities`**. `provider.can.privateObjects` read like a
  question about permission; it is a statement about the vendor.
- `UploadTicket` gained a **`method`**. S3's presigned POST and Vercel Blob's
  handler disagree about the verb, and a client guessing it fails at runtime.

`put` is abstract and universal; `ticket` is abstract and allowed to answer
`null`. That asymmetry is the whole point: **the fast path is optional, the slow
path is not.** A filesystem has no notion of a presigned URL and never will, so
an interface that only presigned would be a lie the filesystem has to fake.

### The four, and how they actually differ

| | `directUpload` | `privateObjects` | `signedReads` | Identity by |
|---|---|---|---|---|
| **S3 / MinIO / R2** | presigned `PUT` | yes, buckets are private by default | yes | our key |
| **Cloudinary** | signed upload preset | only with a paid delivery type | yes, expiring URLs | **its** `public_id` |
| **Vercel Blob** | client token via `handleUpload` | `access: "public"` is the common path | limited | its `pathname` |
| **Filesystem** | **no** | yes, nothing serves it but us | n/a — we serve it | our key |

Three things fall out of that table, and none of them are obvious from the
interface alone:

**Cloudinary does not store under the key it is given.** It returns a
`public_id` of its own, which is why picky-screen's row has `providerId` — and
why ours must too. A design that assumes `storageKey` addresses the object
everywhere breaks on the first provider that renames it.

**Cloudinary and Vercel Blob serve public URLs by default.** For screen-sharing
media that is the feature. **For a passport scan it is a breach.** This is the
constraint the reference project never had to think about and this one cannot
avoid.

**The filesystem cannot do direct upload, and that is fine.** It is the right
provider for a single-box deployment and for local development, and the two-phase
flow below degrades to a single POST for it without any special-casing at the
call site.

### The rule that connects the table to the domain

A kind of file declares what it needs; a provider declares what it can do; the
match is checked once, at startup rather than at upload:

```ts
// src/features/platform/model/attachment.ts
export const KIND_REQUIRES: Record<AttachmentKind, Partial<StorageCapabilities>> = {
  FILE:              {},                      // a room photograph; a CDN suits it
  CONSENT:           { privateObjects: true },
  CONTRACT:          { privateObjects: true },
  IDENTITY_DOCUMENT: { privateObjects: true, signedReads: true },
};
```

`FILE` requires nothing, so it is `{}` rather than `{ privateObjects: false }` —
a kind states what it *needs*, never what it forbids, or adding a capability
would mean revisiting every kind.

So configuring Cloudinary-with-public-delivery and then storing a passport is a
**boot failure with a sentence**, not a quiet exposure discovered later. That is
the same shape as every other rule here: declared once, asked by name, and
refused early.

It also allows the sensible production answer — **room photographs on a CDN,
identity documents on private object storage** — without either becoming a
special case in the calling code. The registry maps kind to provider; the
feature asks for a provider by kind and never names one.

### Two phases, and why they survive a provider without direct upload

1. `attachment.requestUpload` — checks permission, picks the provider for the
   kind, writes the row **pending**, and returns either a ticket or `null`.
2. The client uploads: **to the provider** if it got a ticket, **to our own
   route handler** if it got `null`. One branch, in one place.
3. `attachment.confirmUpload` — `stat()` the object, write the **observed**
   `sizeBytes` and `mimeType`, store `providerId`, mark the row ready.

Step 3 is what closes the hole described at the top: size and type become
observed rather than claimed, whichever path the bytes took. A row never
confirmed is an orphan, swept by the outbox worker.

This needs columns `Attachment` does not have — `provider`, `providerId`, and a
status or `uploadedAt`. A migration, not just code.

### What each provider costs to add

Deliberately prepared for all four, because the expensive part is the interface
and it is the same either way. The adapters are small:

```
src/lib/storage/
  ├── provider.ts     the base class above
  ├── s3.ts           @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner
  ├── cloudinary.ts   cloudinary — signed presets, public_id round-trip
  ├── vercel-blob.ts  @vercel/blob — handleUpload, pathname as providerId
  ├── filesystem.ts   node:fs, plus a route handler that streams with a guard
  └── index.ts        reads `STORAGE_PROVIDER`, imports that one dynamically
```

Only the configured one is constructed, so an unused SDK is a dependency and not
a runtime cost. `env.mjs` validates each provider's variables **conditionally on
which is selected** — a refinement, so choosing S3 without a bucket fails at
startup the way `FIELD_ENCRYPTION_KEY` does.

**Development defaults to `filesystem`**, which needs no account and no Docker
service — that is what ships. A MinIO service alongside `docker/compose/db.yml`
would exercise the S3 path before deploying onto it; it is not written yet.

## Rules worth writing down before the code

- **The mime type is an allowlist, not a denylist**, and it is checked at
  confirmation against what storage reports rather than what the caller said.
- **A size cap per kind.** A passport scan is not a video.
- **`isUnguessableStorageKey` guards every write.** It exists; use it.
- **The adapter is `lib/`, the rules are `model/`, the orchestration is
  `platform/server/`.** The split already used everywhere else, and the reason
  the naming survived a year without a bucket.

## What is still missing

Phase 1 stopped at the seam on purpose: everything above is decided and typed,
and nothing below it is guessed at.

| | Why it waits |
|---|---|
| **The SDKs** — `@aws-sdk/client-s3`, `cloudinary`, `@vercel/blob` | Four dependencies for one provider in use. Added with the adapter that needs one, not before. |
| **The migration** — `provider`, `providerId`, and a pending/ready state on `Attachment` | A column added before the flow that fills it is a column that holds the wrong thing. |
| **`requestUpload` / `confirmUpload`** in `platform/server/` | The orchestration. Needs the columns above. |
| **The route handlers** — `/api/uploads` to receive, and to stream back with a membership check | Only the filesystem needs the receiving half, and it is the only provider that cannot be tested against a real vendor locally. |
| **The startup check** calling `kindsRefusedBy` | Written and tested as a pure rule; nothing calls it until a provider is real. |

The pure parts — the capability flags, `KIND_REQUIRES`, the refusal — are
tested now, because they are the parts a wrong answer is expensive in and the
only parts testable without a vendor.

## Open

- **Room photographs**: a column on `RoomType`, or an `Attachment` with
  `propertyId` and a kind? The second reuses everything; the first is what a
  booking widget will want to query cheaply.
- **Whether one provider serves everything, or one per kind.** The registry
  supports both and the second is probably right — a CDN for photographs a
  browser fetches on every search, private object storage for the documents a
  regulator asks about. Deciding it early costs nothing; discovering it after
  the passports are on a CDN costs a great deal.
- **Whether a scan step gates `IDENTITY_DOCUMENT`.** Direct upload means the app
  never sees the bytes, so any antivirus is an outbox task after confirmation
  rather than a check before it. That is a policy question, not a technical one.
