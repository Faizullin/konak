# The upload UI

The browser half of [file-uploads.md](file-uploads.md). That plan settled where
the bytes go and the server side of it has since landed — the migration, the
procedures, the quota, the sweeps. **Nothing collects a file.** This plan is
what the browser needs: which components exist, where each file goes, and what
makes them reusable by every feature that will want them.

**Built.** Everything below shipped, in the order this plan set out, and it is
mounted on property setup. What follows is kept because it is the reasoning, not
a queue — the sections that are now description rather than proposal are marked.

Four decisions were made while building that this plan left open or assumed:

- **No `progress` primitive.** The bar is nine lines inside `AttachmentsPanel`.
  Adding a shadcn component means a Radix dependency and a CLI run that rewrites
  `styles/globals.css`, for one caller — and `architecture.md` wants the third
  caller before a component exists.
- **`subjectInput()` in `model/subject.ts`.** `SubjectRef` says `number | null`
  and the input schemas say `number | undefined`; sent as `null` a subject reads
  as *set* and fails `hasExactlyOneSubject`. The conversion is in the model
  once rather than at each call site.
- **The panel asks for the caller's role itself**, matching `RatePlansPanel`.
  A prop would save a request; this keeps one way of answering the question.
- **The mount is property setup**, which settles the room-photograph question in
  passing: photographs are an `Attachment` with a `propertyId`, not a column on
  `RoomType`.

**Mounted twice.** Property setup takes one panel; `/directory/<personId>` — a
route created for this — takes three, one per kind. `listAttachments` gained an
optional `kind` filter so a panel lists what it manages rather than repeating
its neighbour.

**A note on the citations below.** `platform/model/attachment.ts`,
`platform/server/attachments.ts` and `app/api/uploads/[...key]/route.ts` are
under active edit, and their line numbers move by the hour. Each reference here
carries the symbol as well as the line, so a drifted number still finds its
subject. Check the symbol, not the digit.

## What the server already gives the browser

Five procedures on `platform.*` in `server/router.ts` — `listAttachments:105`,
`requestUpload:131`, `confirmUpload:139`, `deleteAttachment:148`,
`storageUsage:170` — over the service in `server/attachments.ts`. Both halves of
the byte path exist: `POST /api/uploads/<key>` receives, `GET` serves back, and
membership is re-checked on each.

The rules a browser needs are pure and already in `model/attachment.ts`:
`KIND_LIMITS:79`, `refuseAttachment:116`, `refuseQuota:165`,
`AttachmentStatus:65`, `uploadByteLimit:155`, and the two input schemas —
`requestUploadSchema:205` and `confirmUploadSchema:216`. Every refusal has
English in `messages/en/errors.json`, interpolated by kind, resolved by
`useErrorHandlers`.

So this plan is written against a working back end, not around a missing one.

### Three facts that constrain the components

**`@/lib/storage` is server-only.** `src/lib/storage/index.ts:1` is
`import "server-only"`, and it re-exports the types. The types themselves live
in `provider.ts`, which carries no such import — `model/attachment.ts:2` already
imports `StorageCapabilities` from it. So **a client imports
`@/lib/storage/provider`, never `@/lib/storage`**. Getting that wrong drags the
registry into the browser bundle and fails the build with a message about
`server-only`, which reads like a framework bug rather than a wrong import path.
It belongs in `CLAUDE.md` § Traps.

**`components/common/` is domain-free and translation-free.** Not one file
there imports `@/features` or calls `useTranslations`. `ComboBox`
(`combobox.tsx:40`) takes a `searchFn` instead of data; `FormDialog`
(`form-dialog.tsx:36`) takes `submitText` with an English default. The caller
supplies both the behaviour and the words. Anything added there follows that,
or it is not shared — it is domain code in a shared folder.

**There is no progress primitive and no dropzone dependency.** `components/ui/`
has no `progress.tsx`, and `package.json` has no file-picker library. Both are
decisions this plan has to make rather than assume.

## The seam

`architecture.md` opens with two tests. Applied to uploading a file, they cut
the work into five pieces and put each one somewhere different:

| Piece | The test it answers | Where it goes |
|---|---|---|
| Bytes over the wire, with progress | swappable, knows no rule | `src/lib/upload.ts` |
| What a kind of file allows | both sides must agree | `platform/model/` — all but one function |
| Request → transfer → confirm | knows tRPC and `AttachmentKind` | `platform/client/hooks/` |
| Drop target and file picker | two features would own it together | `components/common/` |
| Panel, dialog, table, badge | knows the domain | `platform/client/components/` |

The consequence worth stating plainly: **the ticket-or-`null` branch lives in
one function and no component ever sees it.** `file-uploads.md` already says
"one branch, in one place"; the hook is that place. A screen that uploads a
passport and one that uploads a room photograph then differ by a `kind` prop
and nothing else, whichever provider is configured.

## 1. `src/lib/upload.ts`

The browser counterpart of `lib/storage/`, standing to it exactly as
`lib/auth-client.ts` stands to `server/auth.ts`. That is why it is `lib/` and
not a feature: it knows a URL, a method and a `File`, and nothing about
attachments.

```ts
export type UploadTarget = {
  url: string;
  method: "POST" | "PUT";
  fields?: Record<string, string>;
};

export function uploadWithProgress(
  file: File,
  target: UploadTarget,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal }
): Promise<void>;
```

`UploadTarget` is `UploadTicket` (`src/lib/storage/provider.ts:47`) minus
`expiresAt` — the transport does not care when a ticket dies, only the
orchestration does.

**It must be `XMLHttpRequest`, not `fetch`.** `fetch` cannot report upload
progress; there is no `upload.onprogress` on it and request streaming is not
usable here. This is the one place in the app where XHR is the correct tool,
and the file should say so — otherwise it gets modernised into a progress bar
that jumps from zero to a hundred.

One function serves all three destinations without a branch at the call site:
`fields` present means a multipart POST (S3's presigned POST, Cloudinary's
signed preset), `fields` absent means a raw PUT, and our own route handler is
just another URL.

## 2. `platform/model/` — one function short

`KIND_LIMITS` and `refuseAttachment` already give the browser the cap and the
allowlist, and `refuseAttachment` is pure, so the picker and the router reach
the same verdict with the same wording. One thing is missing, and only the
frontend wants it:

```ts
/** The `accept` attribute for this kind. A filter, never the check. */
export function acceptAttribute(kind: AttachmentKind): string;
```

`KIND_LIMITS[kind].mimeTypes.join(",")` is the whole implementation. It belongs
in `model/` beside the table rather than in the component, because otherwise
every call site writes its own string and the file picker offers what
`refuseAttachment` will reject — which is a worse failure than refusing up
front, since the person has already chosen the file.

Note that `accept` on an `<input>` is a *filter in the file chooser*, not a
check: drag-and-drop bypasses it entirely. `refuseAttachment` runs on every file
whatever route it arrived by, and the server sniffs the real bytes
(`lib/storage/sniff.ts`) regardless. Three layers, and only the third is
trusted.

## 3. `platform/client/hooks/use-attachment-upload.ts`

The orchestration, and the only thing that knows the flow has three steps.

```ts
const { upload, items, cancel, retry, isUploading } =
  useAttachmentUpload({ organizationId, subject, kind });
```

Per file: `refuseAttachment` → `platform.requestUpload` → **branch once** →
`uploadWithProgress` → `platform.confirmUpload` → invalidate `listAttachments`
and `storageUsage`.

The branch is already shaped for it. `RequestUploadResult`
(`server/attachments.ts:104`) answers with `{ attachmentId, storageKey, ticket,
uploadUrl, expiresAt }`, where `ticket` is `null` for a provider that has none
and `uploadUrl` is where to post instead — so the hook reads
`ticket ?? { url: uploadUrl, method: "POST" }` and the two paths converge on one
call. `confirmUpload` then takes `{ organizationId, storageKey }`
(`confirmUploadSchema`, `model/attachment.ts:216`) — the key, not the id,
because it is what both routes address.

A hook rather than a component because progress, abort and retry belong to the
*transfer*, not to the pixels: a dialog that unmounts mid-upload must abort, and
a panel showing three rows in flight needs one owner of that array. Two
surfaces can then render the same upload differently without either owning the
state machine.

Two behaviours to settle here rather than leave to whoever writes it:

- **`retry`** re-transfers against the same PENDING key while the window holds,
  and re-requests once it has lapsed. The two are different calls and the row
  decides which, so the hook must read the row rather than guess.
- **`multiple` uploads serially.** `requestUpload` reserves quota per file, so
  N files chosen at once would hold N reservations before the first byte moves,
  and the last of them would be refused for space the first is not yet using.

**A cancelled upload needs no cleanup call.** The row's reservation lapses on
its own after `UPLOAD_WINDOW_MS` (`model/attachment.ts:192` — fifteen minutes)
and the sweep releases the quota. Worth a comment, or someone adds a delete
mutation that races the sweeper.

**Quota is refused before the bytes move**, at `requestUpload`, so
`attachment.quota_exceeded` arrives as an ordinary tRPC refusal with `available`
and `needed` already interpolated. The panel should show `storageUsage` beside
the dropzone rather than only on failure — a person who can see the bar fill
does not need the error.

This is the **first `client/hooks/` directory in the tree** — every feature so
far has only `client/components/`. `architecture.md` sanctions it explicitly
("`client/` — `"use client"` components and hooks"), so it is documented and
merely unused. Noted here so it is a decision rather than an accident.

## 4. `components/common/file-dropzone.tsx`

One generic component, named like `ComboBox`: a primitive, so none of the
mechanism suffixes in `architecture.md` § Naming apply.

```tsx
<FileDropzone
  accept={acceptAttribute(kind)}
  maxBytes={KIND_LIMITS[kind].maxBytes}
  multiple
  onFiles={upload}
  disabled={isUploading}
  label={t("attachments.drop")}
  browseLabel={t("attachments.browse")}
/>
```

Drag state, and a hidden `<input type="file">` inside a real `<button>` — not a
`div` with an `onClick`, which cannot be reached by keyboard and announces
nothing. It knows no kind, no tRPC and no attachment; the caller passes the
limits down from `model/` and the words down from `next-intl`, exactly as
`ComboBox` and `FormDialog` are called today.

**No "file progress row" component yet.** `architecture.md` § Errors sets this
codebase's own threshold — *"the third caller, not the second. Two copies are a
coincidence; three are a pattern"* — and there is one caller. The row stays
inside the panel until a second consumer proves its shape.

The bar itself comes from `npx shadcn@latest add progress`. `styles/globals.css`
is shadcn's and the CLI rewrites it; that is already a trap in `CLAUDE.md`.

## 5. `platform/client/components/`

Four files, named by the suffix table in `architecture.md` § Naming.

**`attachments-panel.tsx` → `AttachmentsPanel`.** The reuse seam, and the only
thing another feature imports. Heading, quota line, dropzone, table. Its whole
prop surface is `{ organizationId, subject: SubjectRef, kind }` — `SubjectRef`
and `subjectInputSchema` already exist in `model/subject.ts` and `schemas.ts:7`,
and `requestUploadSchema` extends the same object, so the panel reuses the shape
the router already validates instead of inventing a prop per subject. Follows
`RoomTypesPanel` and `RatePlansPanel`.

It needs a real **"nothing yet" empty state**, separate from "nothing matched".
`ui-patterns.md` § Empty states makes the point that the second is the one
people misread as breakage, and a panel with no files is the first thing anyone
will see.

**`attachment-upload-nice-dialog.tsx` → `AttachmentUploadNiceDialog`, plus an
`uploadAttachment()` wrapper.** A `NiceDialog` reached as a function, like
`confirm()` and `selectOne()`. `ui-patterns.md` § Which tier decides this by
*ownership*, not by call-site count: any feature attaches a file to a subject,
so it is global even with one caller today. It renders through `FormDialog` and
passes `form.formState.errors.root?.message` as `error` — a dialog that omits
that fails silently, which is a trap in `CLAUDE.md` and a section in
`ui-patterns.md`.

**`attachment-table.tsx` → `AttachmentTable`.** A plain `@/components/ui/table`,
not the `DataTable` stack. A person has a handful of documents; URL state, a
toolbar and pagination would be machinery for a list that fits on one screen.
That is the `*Table` versus `*TableView` distinction, and the same call
`inventory-panels.tsx` already made for rooms. Delete goes through `confirm()`
with `destructive: true`, then `platform.deleteAttachment` — the row leaves at
once and the bytes leave when the outbox worker runs.

**`attachment-status-badge.tsx`.** `AttachmentStatus` is `PENDING | READY`
(`model/attachment.ts:65`), plus the client-side *failed* that is not a column
and never reaches the database. `ui-patterns.md` § Colour as data applies: hue
is never the only cue, so each carries a glyph as well, `aria-hidden`, with the
words in the `title`. Both themes on every pair — `dark:` is a class variant
here, not a media query.

## What had to be settled on the server first — all four done

Three defects and one undecided question. Every one was real; each is fixed.

**`deleteAttachment` is MEMBER-level** (`router.ts:148`). Any member can
irreversibly delete an identity document. It is consistent with the rest of the
platform router, which is the problem — `architecture.md` § Permissions are a
table wants an `attachment` resource in `orgStatements`
(`organizations/model/organization.ts:51`) with `create` for MEMBER and `delete`
for managers. The UI needs the predicate anyway, to hide the button; writing
the rule twice is how the two come to disagree.

**`Content-Disposition: attachment` makes previews impossible.** `route.ts:138`
forces a download, so `<img src="/api/uploads/…">` saves a file rather than
rendering one — **there is no thumbnail mechanism at all.** The header's comment
defends against a stored HTML or SVG running scripts in our origin, and that is
already closed a layer up: `KIND_LIMITS` allows neither, and `confirmUpload`
writes the sniffed type rather than the claimed one. `inline` for `image/*`,
`attachment` for the rest, `?download=1` to force, and keep
`Cache-Control: private, no-store`. The same line percent-encodes the filename,
so a file saves as `Marketing%20Consent.pdf`; RFC 5987's `filename*=UTF-8''…`
beside an ASCII fallback is the fix.

**HEIC renders in no browser.** `KIND_LIMITS` allows `image/heic` and
`image/heif` deliberately — it is what an iPhone produces, and a receptionist
photographing a passport will use one. Even after the header fix, those files
have a broken thumbnail. Either transcode on confirmation as an outbox task, or
show a file icon for those two types; the second is enough for now, but it has
to be decided rather than discovered in the panel.

**`readUrl` is exported and called by nothing** (`server/index.ts:21`,
defined at `attachments.ts:291`), so the barrel asserts a use that does not
exist. The client can address `/api/uploads/<storageKey>` directly — the GET
route works for all four providers — which is the simpler answer while signing
is an optimisation for SDKs that are not installed. Drop it from the barrel and
put it back with the first real provider; a `platform.readUrl` procedure
answering `signedUrl ?? routeUrl` is the right end state, mirroring how
`requestUpload` answers `ticket ?? uploadUrl`, but it buys nothing today.

## Two things the parent plan does not cover

**An XHR failure is a third error dialect.** `normalizeError`
(`src/lib/errors.ts:116`) collapses exactly two: tRPC *throws*
`{ message, data }`, Better Auth *returns* `{ data, error }`. Its last two
branches are `error instanceof TypeError` → `network` (`:174`) and a catch-all
→ `server` with generic copy. A 403 from an expired presigned URL, or a 410
from our own route, is neither — so it lands in the catch-all, the person reads
"something went wrong", and the one useful fact — *the reservation lapsed, ask
for another* — is discarded. Fix: `lib/upload.ts` throws a typed
`UploadTransferError` carrying the status, and `normalizeError` grows one branch
for it, mapping 409 and 410 onto `attachment.not_pending`, which already has
English. That keeps "where an error appears is decided once, in `lib/errors.ts`"
true, which is the whole point of that file.

**Direct upload is cross-origin.** Progress events and the response both need
CORS on the bucket, and S3's presigned POST answers with XML or a redirect
rather than JSON. Configuration rather than code, but it is invisible until the
first real provider is switched on, and it presents as "progress never moves".

## Naming and placement, settled

- `FileDropzone` in `components/common/`, no suffix — a primitive, like
  `ComboBox`.
- `AttachmentsPanel`, `AttachmentTable`, `AttachmentUploadNiceDialog` in
  `platform/client/components/`. `Panel` is the established name for a composed
  page section (`OrganizationSettingsPanel`, `RoomTypesPanel`,
  `RatePlansPanel`), even though the suffix table does not list it.
- `useAttachmentUpload` in `platform/client/hooks/` — new directory, sanctioned
  by the guide, first of its kind.
- No new directory under `components/`. Shared UI is `components/common/`.

## i18n, which is three places and not one

A new `messages/en/platform.json`, registered in `messages/en/index.ts`, **and**
added to the provider map in `src/app/(app)/dashboard/layout.tsx:50`. Miss the
third and `useTranslations` throws at runtime on a screen that compiled fine;
miss nothing and `message-keys.test.ts` still fails on a message nothing reads.

The refusals need nothing: every `attachment.*` code already has English in
`errors.json`, and `useErrorHandlers` resolves them. `FileDropzone` takes its
words as props with English defaults, per the `components/common/` convention
above, so only the platform components call `useTranslations`.

## Not built yet, deliberately

- **The room-photograph gallery.** `file-uploads.md` § Open has not settled
  whether photos are a column on `RoomType` or an `Attachment` with a
  `propertyId`. The frontend argues for the second — it reuses every layer here,
  and a column needs a second upload path — but that is a schema decision, not a
  UI one. A gallery with drag-reorder is a different component from a document
  table in any case, and it sits on the same hook when it arrives.
- **Chunked or resumable upload.** A passport scan is not a video, which is what
  `KIND_LIMITS` says out loud.
- **Client-side image compression**, and any antivirus indicator. Both are
  post-confirmation policy — see `file-uploads.md` § Open.

## The order — followed

1. ✅ `attachment` in `orgStatements`, with `canUploadAttachments` and
   `canDeleteAttachments`. A MEMBER attaches; a manager deletes.
2. ✅ `Content-Disposition` now RFC 6266 with both halves, `inline` for what a
   browser renders, `?download` to force. `rendersInBrowser` and
   `isThumbnailable` answer the HEIC question in `model/`, once.
3. ✅ `acceptAttribute` in `model/`, with a test that the picker offers exactly
   what `refuseAttachment` accepts. `readUrl` gone from the barrel.
4. ✅ `lib/upload.ts` and the `normalizeError` branch, matched by shape.
5. ✅ `FileDropzone`.
6. ✅ `useAttachmentUpload`.
7. ✅ Panel, dialog, table, badge.
8. ✅ `messages/en/platform.json`, in all three places.

## Open

- **Whether `components/common` should be lint-guarded.** `eslint.config.mjs`
  restricts `./src/lib` and `./src/components/ui` from importing
  `./src/features` but not `./src/components/common`, which is domain-free
  purely by discipline. `FileDropzone` keeps that discipline — words as props,
  limits as numbers — but nothing enforces it.
- **Whether `listAttachments` should narrow its select.** It still returns whole
  rows, so `reservedBytes`, `releaseAt` and `providerId` reach the browser.
  Harmless, and the table uses none of them.
- **Direct upload is cross-origin.** Progress and the response both need CORS on
  the bucket, and S3's presigned POST answers with XML or a redirect. Invisible
  until the first real provider, and it presents as "progress never moves".
