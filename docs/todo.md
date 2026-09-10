# Todo

The next few things, in order. A title and one line of why — no status, no
boxes. A finished item leaves here; the fact of it goes to `history.md`.

Where this sits in the whole build: `plans/roadmap.md`.

## File uploads — done
Two phases, so nothing about a file is believed until storage is asked; per-kind
size caps and type allowlists; a per-organization quota that counts unconfirmed
reservations; sweeps for abandoned uploads and expired retention; bytes that die
with their row, including through an organization cascade. Uploading and
deleting are separate rights — a receptionist attaches a passport scan, a
manager deletes one.

The browser half is built and mounted on property setup: `lib/upload.ts`,
`useAttachmentUpload`, `FileDropzone`, and `AttachmentsPanel` — the seam any
feature can mount, or open as a dialog with `uploadAttachment()`.

Two screens carry it: property setup, and the person detail route reached from
the directory. What is left is the SDK for whichever provider production uses —
nothing else, and nothing until a deployment picks one.
`plans/file-uploads.md` and `plans/file-uploads-ui.md`.

## Visual design and motion
Once the product works. Density, colour-as-data, keyboard rules, and
animation only where it explains something. Until then shadcn's defaults, which
are good enough to run a hotel and cheap to replace.

## Internationalisation
The extraction is finished — refusals, Zod messages, page shells, every
feature's components and the label tables. `npm test` fails on a message nothing
reads and on a key nothing declares, in both directions.

One thing remains: **a second locale**, and it waits on a reader rather than on code. Every
string already comes from `messages/en/`, and the checks fail on a message
nothing reads or a key nothing declares — so the machinery is finished and
waiting. Adding a language before there is someone to read it proves nothing and
dates immediately; adding it after the product settles is a translation job
rather than a code one.

## An external API, with keys
Last on purpose. Everything above is a product a hotel uses; this is a surface
other software uses, and it is worth building once the thing it exposes has
stopped moving.
Nothing outside this repository can call it. tRPC's contract is a TypeScript
type, so there is no schema to publish and no version to pin, and
`src/server/root.ts` is internal by construction. A versioned REST surface with
scoped API keys is what a booking engine, a channel manager and the Phase 8
widget all need — and Phase 8 needs the rate limiting it forces anyway.
`plans/external-api.md` has the shape, the scopes and what must exist first.
