# The upload UI

The browser half of [file-uploads.md](file-uploads.md). That plan settled where
the bytes go; the server side of it landed while this was being written — the
migration, the two procedures, the quota, the sweep. **None of it is reachable
from a screen.** This plan is what the browser needs: which components exist,
where each file goes, and what makes them reusable by the four features that
will want them.

Nothing here is built. There is no upload UI in the tree at all.

## Where the frontend actually stands

`src/features/platform/` has a `model/` and a `server/` and **no `client/`**.
Nothing under `src/components/` or any feature's `client/` mentions a file, an
upload or an attachment. Greenfield, which is the good case: the seam can go in
the right place the first time rather than being extracted from three copies.

The server is further along than the parent plan says. Five procedures are
wired in `platform/server/router.ts` — `listAttachments:104`,
`requestUpload:127`, `confirmUpload:135`, `deleteAttachment:144` and
`storageUsage:166` — over the service in `server/attachments.ts`. The domain
rules a browser needs are all in `model/attachment.ts`: `KIND_LIMITS:96`,
`refuseAttachment:136`, `refuseQuota:180`, `AttachmentStatus:79`,
`MAX_UPLOAD_BYTES:127`, and the two input schemas at `:223` and `:234`. Every
refusal already has English in `messages/en/errors.json`, interpolated by kind.

So the model layer this plan would otherwise have specified **is done**, and
what follows is written against it rather than around it.

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
| What a kind of file allows | both sides must agree | `platform/model/` — **done** |
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
check: drag-and-drop bypasses it entirely. `refuseAttachment` runs on every
file whatever route it arrived by, and the server sniffs the real bytes
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
(`server/attachments.ts:112`) answers with `{ attachmentId, storageKey, ticket,
uploadUrl, expiresAt }`, where `ticket` is `null` for a provider that has none
and `uploadUrl` is where to post instead — so the hook reads
`ticket ?? { url: uploadUrl, method: "POST" }` and the two paths converge on one
call. `confirmUpload` then takes `{ organizationId, storageKey }`
(`model/attachment.ts:234`) — the key, not the id, because it is what both
routes address.

A hook rather than a component because progress, abort and retry belong to the
*transfer*, not to the pixels: a dialog that unmounts mid-upload must abort, and
a panel showing three rows in flight needs one owner of that array. Two
surfaces can then render the same upload differently without either owning the
state machine.

**A cancelled upload needs no cleanup call.** The row's reservation lapses on
its own after `UPLOAD_WINDOW_MS` (`model/attachment.ts:207` — fifteen minutes)
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
(`model/attachment.ts:79`), plus the client-side *failed* that is not a column
and never reaches the database. `ui-patterns.md` § Colour as data applies: hue
is never the only cue, so each carries a glyph as well, `aria-hidden`, with the
words in the `title`. Both themes on every pair — `dark:` is a class variant
here, not a media query.

## What the frontend is still blocked on

Both of these are server-side, and neither is in `file-uploads.md`'s remaining
list because that list was written before the rest of it landed.

**There is no `/api/uploads` route handler.** `requestUpload` returns a
`uploadUrl` for the no-ticket path and nothing serves it. The filesystem
provider is the development default and it can *never* issue a ticket — that is
the whole reason the two-phase flow exists — so **on a default clone the
fallback is the only path, and it 404s.** The UI cannot be built or seen working
locally until that handler exists. It is the first thing to write.

**There is no `readUrl` procedure.** `readUrl()` exists in the service
(`server/attachments.ts:298`) and nothing exposes it over tRPC, so a client
cannot open or preview a stored file at all. When it is added, note the shape it
forces: `READ_TTL_SECONDS` is five minutes (`attachments.ts:34`), so a URL is a
**query result with a TTL, not a column** — it needs a `staleTime` under that,
or images 404 after five minutes on screen. And for `IDENTITY_DOCUMENT` the URL
should never reach an `href` a person can right-click and copy; the point of an
expiring link is lost the moment it is pasted into a chat, which is the reason
`attachment.provider_unsigned` exists.

## Three things the parent plan does not cover

**An XHR failure is a third error dialect.** `normalizeError`
(`src/lib/errors.ts:116`) collapses exactly two: tRPC *throws*
`{ message, data }`, Better Auth *returns* `{ data, error }`. Its last two
branches are `error instanceof TypeError` → `network` (`:172`) and a catch-all
→ `server` with generic copy. A 403 from an expired presigned URL is neither a
`TypeError` nor a tRPC error, so it lands in the catch-all: the person reads
"something went wrong" and the one useful fact — *the ticket expired, ask for
another* — is discarded. Fix: `lib/upload.ts` throws a typed
`UploadTransferError` carrying the status, and `normalizeError` grows one branch
for it, mapping an expired ticket onto `attachment.not_pending`, which already
has English. That keeps "where an error appears is decided once, in
`lib/errors.ts`" true, which is the whole point of that file.

**There is no page to put the panel on.** The directory route renders a table
with no person detail page beneath it, so the natural first home for attachments
does not exist yet. The honest first consumer today is the property setup
screen: `propertyId` is already a valid subject, the route exists, and it is
manager-gated. Without one, the panel ships as dead code — and an unused shared
component asserts a sharing that does not exist, the same way an empty barrel
does.

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

The refusals need nothing: all nine `attachment.*` codes already have English in
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

## The order

1. `/api/uploads`, or nothing below can be seen working on a default clone.
2. `acceptAttribute` in `model/`, and a `readUrl` procedure.
3. `lib/upload.ts` and the `normalizeError` branch.
4. `FileDropzone`.
5. `useAttachmentUpload`.
6. Panel, dialog, table, badge.
7. `messages/en/platform.json`, in all three places.

## Open

- **The first mount.** Property setup is available now; a person detail route is
  what the product actually wants. Building the panel before either exists is
  building for nobody.
- **Whether `components/common` should be lint-guarded.** `eslint.config.mjs:61`
  restricts `./src/lib` and `./src/components/ui` from importing `./src/features`
  but not `./src/components/common`, which is domain-free purely by discipline
  today. Adding it to that zone would make the convention a build failure
  instead of a habit, and nothing currently there would break.
- **Whether the panel or the calling feature owns the permission check.** Every
  other panel asks `trpc.organization.getById` for the caller's role and hides
  its buttons; a shared panel doing that adds a query to every screen that
  mounts it. Passing the role in as a prop is the alternative, and pushes the
  question back to the feature that already knows it.
- **Whether `listAttachments` should narrow its select.** It returns whole rows
  (`router.ts:104`), so `reservedBytes`, `releaseAt` and `providerId` all reach
  the browser. Harmless today and everything the table needs is in there, but a
  panel is the wrong place to discover it.
