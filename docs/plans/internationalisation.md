# Internationalisation

Every string in the app is inline English. This is the reading behind the
choice, the choice itself, and the two things no library answers.

Nothing here is built. `todo.md` names the two entries this covers: *Pick a
translation library* and *Next 16, read against the docs* — which `todo.md` puts
first, and which turned out to matter for a reason it did not predict.

## What Next 16 changes for us

Read against the [upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16),
documented at 16.3.4. Most of it does not touch this codebase — no `next/image`,
no `revalidateTag`, no parallel routes, no `serverRuntimeConfig`, no PPR, and
`params` is already awaited everywhere. Three things do.

**The build stops printing the numbers our own gate reads.** Next 16 removes
`size` and `First Load JS` from `next build` output, calling them inaccurate in
server-driven architectures. `roadmap.md:164-166` records a bundle floor of
245 kB and `/dashboard` at 403 kB and says "the build prints both"; `How a phase
ends` asks whether a route's first-load bundle grew. **Upgrading removes the
instrument before it removes the obligation.** A replacement has to land in the
same change — summing the shared chunks from `.next/app-build-manifest.json`
gives exact bytes and is what the last two phase-end passes actually used when
the printed kilobyte was ambiguous.

**`middleware.ts` becomes `proxy.ts`.** We have neither, and
`architecture.md:358` says that absence is the design. It matters only because
it is what most i18n setup guides reach for first — see below.

**Turbopack is the default**, so the `--turbopack` flags in `package.json:6-7`
become redundant. `next lint` is removed; we already run `eslint` directly.

## The choice: `next-intl`, without i18n routing

Not because it is the best library in the abstract — because three properties of
this codebase decide it before the feature comparison starts.

### The constraints that decide it

**We have no middleware and do not want one.** Locale-prefixed routing
(`/en/dashboard/...`) is every library's default and every library implements it
with a proxy that rewrites the URL. Adopting that would reverse the decision at
`architecture.md:358` for a reason unrelated to access control.

**The URLs are the product.** Routes are slug-keyed — `/dashboard/orgs/acme` —
because a slug is "the half a person can read, type and share". A locale segment
changes every one of them, and every link anyone has saved.

**Half the strings are server-side refusals.** 77 domain codes now exist across
seven `model/errors.ts` catalogues and `SharedError`, thrown with 104 English
messages behind them. That is the larger half of the translation surface, it
lives in routers rather than components, and it is already keyed — which is what
the previous two entries in `history.md` were for.

`next-intl` supports a **no-routing** mode: locale comes from a cookie or the
application's own logic through `i18n/request.ts`, `getTranslations` serves
Server Components and `useTranslations` serves Client Components, and no
proxy is involved. URLs are untouched. That is the whole of the fit.

### Why not the other three

**`next-i18next` v16** is a real App Router library now — `getT`/`useT`, and a
no-locale-path mode equivalent to the above. Its advantage is that from Next
16.3 `getT` resolves the language from `next/root-params` first, and root params
are part of the route key, so unlike `cookies()` they do not opt a route out of
prerendering. That advantage requires a `[locale]` segment, which is the URL
change we just refused. Worth revisiting only if Phase 8 or 11 make prerendered
public pages a requirement.

**Paraglide JS** — `todo.md` says it "has no App Router story at all". **That is
now wrong.** Paraglide 2.0 dropped the Next adapter and documents App Router and
RSC directly; messages compile to plain functions with no context, so server
messages cost no client bundle. It is a genuine contender and the note dismissing
it should not be trusted. It loses here on shape rather than capability: a
compile step over message functions is awkward for a hundred refusals looked up
dynamically by a code, which is exactly our larger half.

**Lingui** wants a macro and a Babel or SWC plugin. Next 16 makes Babel opt-in
alongside the React Compiler and warns it slows builds. New build machinery for
a dashboard's worth of strings is the wrong trade.

## Zod messages, and why a schema factory does not fit

The larger half of the surface is server refusals, and they are keyed. The
**third** half — 171 English strings inside Zod schemas in `model/` — is the
one that resists.

The usual answer is a factory: `createLoginSchema(t)`, built per request with a
translator. **It does not work here**, and the reason is the reason `model/`
exists. `createOrganizationSchema` is a module-level const used twice: at
`organizations/server/router.ts:42` as `.input(createOrganizationSchema)` and at
`organization-form-nice-dialog.tsx:41` as the form's resolver. A router's
`.input()` is evaluated when the router is defined, with no request and no
locale, so a factory can only serve the form — leaving the router on a second
schema. `architecture.md:132-135` names that exact failure:

> Written twice they drift — the form enforces the slug format while the router
> accepts any non-empty string, and a caller reaching tRPC directly creates a
> slug the UI would never produce.

**The answer is the one we already used for refusals: a message becomes a key.**
`z.email("Enter a valid email address")` becomes `z.email("field.email_invalid")`,
and the string is resolved where it is rendered. The server never needs a locale
to validate, the schema stays a single shared const, and `zodError.fieldErrors`
already arrives at the client as strings that `lib/errors.ts:107` hands to a
component holding `useTranslations`.

It costs one thing worth stating plainly: a raw Zod failure logged on the server
reads as a key rather than a sentence. That is the same trade the domain codes
made, and the same answer — the code is the stable half.

## What no library answers

**Prisma content.** Room type names, rate plan names, cancellation policies —
these are rows a hotelier typed, not keys a developer wrote. No translation
library touches them, and the schema has one `name` column
(`inventory.prisma:17`, `rates.prisma:21`). Whether a property running in two
languages needs a translations table is a data-model decision, and it is
deliberately **not** part of picking a library.

**Where a person's locale lives.** There is no `locale` column on `User`, and
there must not be a hand-edited one: `identity.prisma` is generated, so this
goes in `user.additionalFields` in `server/auth.ts` and then
`npm run auth:generate` — the trap `CLAUDE.md` lists. Until that exists, a
cookie set from the browser's `Accept-Language` is the honest interim.

## Adopted, and declined, from the wider recommendation

A second opinion on this was worth reading. Three of its points are taken:

- **Typed keys.** A global `IntlMessages` interface gives compile-time errors on
  a typo and autocomplete on a namespace. Cheap, and it is the same instinct as
  the `_LABELS` tables that already stop a screen drawing a raw column value.
- **A parity check in the gate.** A script that fails the build on a missing or
  orphaned key belongs beside `lint`, `test` and `format:check` — this project
  already gates on measurements rather than intentions.
- **Namespaced message files** rather than one flat object per locale.

Three are declined, and it is worth saying why rather than just not doing them:

- **`/[locale]` subpath routing "to eliminate flicker".** The flicker argument
  does not apply: a flash of English is a *client-side detection* symptom, and
  `getTranslations()` in a Server Component puts the right language in the first
  byte of HTML. The real argument for a locale segment is prerendering, and
  fifteen of this app's sixteen routes are already dynamic — it is an
  authenticated per-tenant dashboard, so nothing is CDN-cacheable whatever the
  URL says. It would cost a proxy and every saved link.
- **"0 KB client mode" — omit the provider and pass every string as a prop.**
  Real, and wrong for this UI. The reservation grid, every `NiceDialog` and
  every form are client components; threading their strings through props would
  be worse than shipping the namespaces they use. The *partial* provider — only
  the namespaces a client tree needs — is the version that applies.
- **Route handlers reading `Accept-Language` for a mobile client.** There is no
  mobile client and none on the roadmap, and the API is tRPC rather than REST.
  The real version of this point is narrower and is step 3 below: **the locale
  enters through the tRPC context**, next to `db` and `session`, which is the
  only place a procedure could read it.

**Translation dashboards** — Fink, Tolgee — are a real answer to a problem that
starts with the second locale and the first non-developer translator. Neither
exists yet. Noting them is enough.

## The order, and why it is not the order `todo.md` implies

`todo.md` puts the Next 16 reading first because "two of the candidates
configure themselves differently on either side of that line". Having read it:
**the recommended choice does not depend on the version.** `next-intl` in
no-routing mode is configured identically on 15.5.9 and on 16.x. Only
`next-i18next`'s root-params mode is version-dependent, and that is the option
being declined.

The upgrade shipped, and so did the wiring — `history.md` has both. What is left
is the part that was always the work:

1. **Turn the 171 Zod messages into keys**, which is the same move one layer
   down and the only part that touches every feature's `model/`.
2. **The rest of the client strings** — the dashboard, the grid, the dialogs.
   Mechanical once the first two settle the shape, and each route mounts the
   provider with the namespaces it renders.
3. **Then a second locale**, which is the first point at which any of this is
   testable by reading a screen — and the point at which a parity check and a
   translation dashboard start earning their keep.

**The server half shipped** — `history.md` has it, and it settled the question
this plan left open: the **client** resolves a code, and the server stays
locale-free. Nothing was added to `createTRPCContext`, because nothing would
have used it. That changes when something a person reads leaves the browser — an
email, a fiscal filing, a channel error — which is Phase 7 and Phase 9, not now.

It also found a surface this plan had not named: **five refusals whose sentence
is computed by a rule in `model/`**. `refuseStatusChange` and its siblings return
the words, and which words depends on why, so a single key cannot reproduce
them. They keep the server's English until those rules return codes too, and a
test pins the list so the debt stays visible.

Step 1 is where the work still is; step 3 is what proves it.
