# Todo

The next few things, in order. A title and one line of why — no status, no
boxes. A finished item leaves here; the fact of it goes to `history.md`.

Where this sits in the whole build: `plans/roadmap.md`.

## An external API, with keys
Nothing outside this repository can call it. tRPC's contract is a TypeScript
type, so there is no schema to publish and no version to pin, and
`src/server/root.ts` is internal by construction. A versioned REST surface with
scoped API keys is what a booking engine, a channel manager and the Phase 8
widget all need — and Phase 8 needs the rate limiting it forces anyway.
`plans/external-api.md` has the shape, the scopes and what must exist first.

## File uploads
`Attachment` rows point at storage keys that were never written to, and
`fileName`, `mimeType` and `sizeBytes` are caller claims nothing verifies.
**The provider layer is prepared** — `lib/storage/` has the base class, all four
adapters and the registry, and `KIND_REQUIRES` keeps a passport scan off a
public CDN — but every method that moves bytes throws. What remains is the SDKs,
the `provider`/`providerId` migration, `requestUpload`/`confirmUpload`, and the
route handler. `plans/file-uploads.md` § What is still missing.

## Visual design and motion
Once the product works. Density, colour-as-data, keyboard rules, and
animation only where it explains something. Until then shadcn's defaults, which
are good enough to run a hotel and cheap to replace.

## Internationalisation
The extraction is finished — refusals, Zod messages, page shells, every
feature's components and the label tables. `npm test` fails on a message nothing
reads and on a key nothing declares, in both directions.

One thing remains: **a second locale**, and it is deliberately last. Every
string already comes from `messages/en/`, and the checks fail on a message
nothing reads or a key nothing declares — so the machinery is finished and
waiting. Adding a language before there is someone to read it proves nothing and
dates immediately; adding it after the product settles is a translation job
rather than a code one.
