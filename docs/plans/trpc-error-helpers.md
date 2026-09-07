# Named errors for the throws that repeat

Twenty `new TRPCError` sites across `src/server` and `src/features` hand-write
`{ code, message }`. Most of them should stay that way. Two problems in the set
are worth fixing, and neither is "there is no wrapper".

## The evidence

Codes in use: `NOT_FOUND` ×7, `BAD_REQUEST` ×5, `FORBIDDEN` ×5, `CONFLICT` ×2,
`UNAUTHORIZED` ×1.

**Two messages are written twice**, in files that do not import each other, so
nothing makes them change together:

| Message | Sites |
|---|---|
| `"Member not found"` | `features/organizations/server/router.ts:252`, `:296` |
| `"User not found"` | `features/identity/server/router.ts:77`, `server/auth.ts:101` |

**Two throws carry no message at all**, so the client toasts tRPC's generic
default while all eighteen others toast a written sentence:

- `server/trpc.ts:40` — `new TRPCError({ code: "UNAUTHORIZED" })`
- `server/trpc.ts:61` — `new TRPCError({ code: "FORBIDDEN" })`

This matters because every client handler is
`onError: (e) => toast.error(e.message)` — nine of them, byte-identical. The
message *is* the UI. A throw without one ships an empty sentence to a toast.

## What not to do

Do not add `notFound(msg)` / `forbidden(msg)` wrappers across all twenty sites.
Sixteen of the messages are unique and domain-specific; a wrapper there saves
one object key and adds one indirection. `../guides/architecture.md` already
says to extract at the third caller, not the second — and sixteen of these have
exactly one caller each.

## What to do

Add `src/server/errors.ts` holding **only** the errors that repeat or that
encode an invariant which must not drift:

- `userNotFound()` — replaces both `"User not found"` sites
- `memberNotFound()` — replaces both `"Member not found"` sites

Give the two bare throws in `server/trpc.ts` a written message, in the voice of
the rest of the set: one says you are not signed in, the other says you are
signed in and this is not yours. Leave the remaining sixteen literal.

`server/errors.ts` is framework, not feature: it sits beside `trpc.ts` and
`auth.ts` for the same reason those do. It must not import from `features/` —
`auth.ts` is loaded by `npm run auth:generate` through jiti, which does not
read tsconfig `paths` (see `../guides/local-development.md`).

## Done when

- `"User not found"` and `"Member not found"` each appear once in `src/`.
- No `new TRPCError` in `src/` omits `message`.
- `npm run lint`, `npm test`, `npx tsc --noEmit` and `npm run build` all pass.
