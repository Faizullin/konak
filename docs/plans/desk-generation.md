# Desk generation

Making a second desk cost a registry entry instead of a copied layout — and, on
the way there, giving the one desk that exists a sidebar worth the eight hours a
receptionist spends looking at it.

Two plans already touch this ground and this one does not repeat either.
[second-surface.md](second-surface.md) prices a surface on **another CSS base**
— Bootstrap, Ant, a client's own design system — and that pricing stands
unchanged. `ui-patterns.md` § Surfaces and themes states the three axes and the
rule that a surface with its own base owns its own components, and that is
binding.

**What neither covers is the machinery in between.** `/desk` was built by
writing a layout by hand. A third surface, on the same base or another one,
would be built by *copying* that layout — and the copy is where the three
shells start disagreeing about guards, providers, message namespaces and where a
link goes. This plan is the descriptor and the shell that make the copy
unnecessary, so that the expensive axis in `second-surface.md` is the **only**
thing a new desk pays for.

---

## 1. What is actually there, read rather than remembered

Two shells exist. They share about seventy per cent of their shape, and most of
that shared shape is still written twice:

| | `dashboard/layout.tsx` | `desk/[orgSlug]/[propertySlug]/layout.tsx` |
|---|---|---|
| Session guard | `getSession` → `/sign-in` | the same, copied |
| Organisation | — | `organizationBySlug` + `notFound()` |
| Module gate | — | `isOrgModuleEnabled("FRONT_DESK")` |
| Locale + messages | hand-listed | hand-listed, a different set |
| Theme | not read — `basic` has one | `toTheme("desk", cookie)` |
| Providers | `NextIntl` → `NiceModal` | `NextIntl` → `SurfaceLinks` → `NiceModal` |
| Chrome | `SidebarProvider` + `AppSidebar` + header | `SidebarProvider` + `DeskSidebar` + `DeskBar` |
| Stamp | `data-surface` on `SidebarProvider` | `data-surface` + `data-theme` on a `div` |

The registry is honest about what it knows and it knows very little.
`config/surfaces.ts` carries `{ id, themes, base }` and nothing else — not the
route it lives at, not its nav, not the namespaces it renders, not the module it
requires. Everything a surface actually *is* lives in its layout file, which is
why a second one is still a copy: the **Chrome** row now agrees between the two
shells, but every row above it does not.

### The desk sidebar, since resolved

The hand-rolled `<aside>` and its flat `SECTIONS` array are gone. The desk now
shares the dashboard's own frame:

- `config/surface-nav.ts` (`deskNavItems`) — data, the `NavGroup`/`NavMainItem`
  shape `config/nav-items.ts` already defined, Setup gated on
  `canManageProperties(role)`.
- `features/desk/client/components/desk-sidebar.tsx` — `Sidebar` +
  `PropertySwitcher` in the header + `NavMain` + `NavUser` in the footer,
  `collapsible="icon"`, the same `sidebar_state` cookie the dashboard reads.
- `features/properties/client/components/property-switcher.tsx` — the
  organisation's other properties, from `property.list`, the current one read
  from the route.
- `app/desk/[orgSlug]/[propertySlug]/setup/page.tsx` — rate plans, channel
  mappings, photographs; rooms and room types stay on the desk's own
  `rooms/page.tsx` rather than being drawn twice.
- `messages/{en,ru}/desk.json` lost its duplicated `nav.*` block; sidebar words
  live in `messages/{en,ru}/nav.json` beside the dashboard's own.

**Not resolved by this pass, and still open below:** the badge slot (§
"The order to build it in", step 4 — waits on `notifications.md`), and the
`toggles` argument `deskNavItems` does not yet take (nothing on the desk's nav
is module-gated today, only role-gated, so it was not added speculatively).

---

## 2. The surface descriptor

`config/surfaces.ts` grows from a theme registry into the answer to *what is a
surface*. Data only — it is read by server layouts, so nothing in it may import
a component:

```ts
export interface Surface {
  id: string;
  base: SurfaceBase;
  themes: { id: string }[];

  /** Where it lives. `/desk`, `/dashboard`. Routes select the surface. */
  stem: string;
  /** The org module it requires, if any. `notFound()` when off. */
  requiresModule?: OrgModuleId;
  /** Which `messages/<locale>/*.json` its screens read. § 3. */
  namespaces: MessageNamespace[];
  /** Which nav builder draws it — an id, resolved client side. `surface-nav.ts` already has one. */
  nav: string;
  /** Whether a property is part of its address, or only an organisation. */
  scope: "organization" | "property";
}
```

Three consequences, and they are the whole point:

- **`env.mjs`'s `DEFAULT_SURFACE`** — declined as an edition system and kept as
  one narrow variable in `second-surface.md` § 4 — gets the pinned test that
  section asks for almost free: the enum literal and `Object.keys(SURFACES)`
  compared in a unit test, since `env.mjs` cannot import the registry through
  jiti (`CLAUDE.md` § Traps).
- **The links contract stops being guessed.** `stem` and `scope` are exactly
  what `SurfaceLinksProvider` is handed by hand today.
- **A new surface is a literal**, and TypeScript tells you which fields you
  forgot. That is the generation this plan is named for.

`SurfaceBase` stays `"shadcn"` with one legal value. This plan does not add a
base; it makes the day one is added cheaper, and `second-surface.md` is still
the document that prices it.

## 3. The shell, written once

`components/layout/surface/surface-shell.tsx` — a server component taking a
`SurfaceId`, the resolved route params and `children`, and doing every row of
§ 1's table: the session guard, the organisation lookup, the module gate, the
theme cookie, the provider stack, the `data-surface` / `data-theme` stamp.

A layout then reads:

```tsx
export default async function DeskLayout({ children, params }) {
  return <SurfaceShell surface="desk" params={await params}>{children}</SurfaceShell>;
}
```

which is `app/` holding routing and nothing else, for the first time on this
surface.

Two things it must get right, because both are already-paid-for lessons:

- **Namespaces come from the descriptor, not from a hand-written object
  literal.** Each layout lists them today and the two lists disagree by three
  entries. `namespaces` in § 2 becomes `Object.fromEntries` over `messages`.
  The reason they were hand-listed is real and survives — *mounting every
  namespace puts every string in every bundle, and next-intl cost the two auth
  routes 39 kB each* — so the descriptor narrows exactly as the literal did, and
  `npm run bundle` before and after is the proof, not an assumption.
- **What crosses into the shell is data, not functions.** The shell is a server
  component and `surface-links.tsx` is `"use client"`; a builder function passed
  down is the *"attempted to call it from the server"* 500 that
  `surface-links.tsx:19` documents. Strings only.

**The chrome stays the surface's own.** The shell renders the providers and the
stamp; what goes inside is `children`, a sidebar slot and a bar slot. A surface
on another base passes its own components into the same shell, which is the only
reason this file is shareable at all.

## 4. Everything common, and where it is configured

The checklist a new desk touches, in the order it touches it. This is the
section the guide in § 6 is condensed from.

| What | Where | Note |
|---|---|---|
| The registry entry | `config/surfaces.ts` | § 2. TypeScript names the missing fields |
| The route | `app/<stem>/…/layout.tsx` | a real segment, never a route group |
| The nav | `config/surface-nav.ts` | data; icons by string — `deskNavItems` is the precedent |
| The links | `store/surface-links.tsx` | `stem` + `directory` today; § 4.1 |
| The styles | `styles/<surface>.css`, imported in `index.scss` | after the blocks it overrides |
| The theme | `SURFACES[id].themes` + `shell.theme.<id>` in both locales | label by convention, not a field |
| The strings | `namespaces` on the descriptor | narrow, and measure |
| The lint zone | `FEATURES` in `eslint.config.mjs` | **a feature not listed is unguarded** |
| The screens | `features/<surface>/client/components/` | only if the base differs |

Two of those rows deserve more than a line.

### 4.1 The links contract is the load-bearing one

`SurfaceLinks` is `grid()`, `bookings()`, `booking()` today, plus
`usePersonLink` and `useBookingLink` beside it. Three additions, and all three
have a caller waiting:

- **`home()` and `signIn()`** — `second-surface.md` § 3.3 asks for these, and
  `sign-in-form.tsx` hard-coding `router.push("/dashboard")` is the same bug
  class as the inline hrefs that file was written to kill.
- **`notifications()` and a target resolver.**
  [notifications.md](notifications.md) § 1a settles on a *polymorphic* target —
  `targetType` + `targetId`, no foreign key, on the `AuditLog` precedent — which
  means the href for a notification is computed from a closed vocabulary in
  `model/` rather than read from a relation. **That decision is only safe
  because this contract exists.** An open target vocabulary plus a component
  building its own URL is a bell that throws people off their surface, and a
  vocabulary whose kinds a surface has no route for must render as text rather
  than as a link to nothing.

  So `SurfaceLinks` grows a `supports(kind)` question and each surface answers
  it. The desk has no route for a `FOLIO` target outside a booking; the
  dashboard does. A link a surface cannot serve is not rendered — not rendered
  broken.

### 4.2 The lint zone is the one that fails silently

`architecture.md`: zones are written per feature because the rule does not
expand a glob in `target`, and **a zone that matches nothing reports nothing,
which is worse than no rule at all.** A new surface feature absent from
`FEATURES` in `eslint.config.mjs` is a client directory free to import a
`server/`, and the build will not say so. It belongs in the § 6 checklist in
bold, and it belongs in the same commit as the directory.

## 5. What this does not do

- **Add a base.** `SurfaceBase` keeps one legal value.
  [second-surface.md](second-surface.md) prices the day it grows a second, and
  nothing here contradicts it.
- **Add a procedure.** Every screen and control named above calls something that
  exists. If a step needs a new one it is in the wrong plan —
  `second-surface.md` § 1 sets that test and this plan is held to it.
- **Touch `/dashboard`'s appearance.** The dashboard's sidebar is the model here,
  not the patient. The only shared files it gives up are `NavMain` and the
  `NavGroup` types, which it keeps rendering byte-identically.
- **Build a third surface.** It makes one cheap. Building one speculatively is
  the mistake `todo.md` names about the dashboard's second palette.
- **Move the desk's bar into the shell.** A surface owns its own chrome. The bar
  is 48px because a grid is read for eight hours, and a shared header would
  immediately grow a *"which surface is this?"* prop — the rot
  `ui-patterns.md` warns about, one layer up.

## 6. The compact guide, written last

When the steps below are done, one new file: **`docs/guides/surfaces.md`** —
*Adding a surface*. Compact on purpose, one screen, no prose about why:

1. The § 4 table as a checklist, in order, with the lint zone in bold.
2. The one decision that forks the work — *same base or another?* — with a
   sentence each: same base is a registry entry, a nav file, a CSS block and a
   layout of three lines; another base is `second-surface.md` and a component
   library.
3. What a surface may not own: a `model/`, a `server/`, a barrel, a procedure, a
   second Better Auth.
4. The two traps that cost a day each: a function crossing into a server layout,
   and a vendor stylesheet that is never unloaded once imported.
5. Links out: `ui-patterns.md` § Surfaces and themes for the rules,
   `second-surface.md` for the price of a base, `architecture.md` for the import
   zones.

It is a **guide**, so it is written when the thing exists and it describes what
is there — not now, and not as a promise. When it lands, this plan has nothing
left in it and deletes itself; what it taught goes to the guide and the fact of
it to `history.md`. That is the convention in `plans/index.md`, and a plan that
outlives its guide is the thing that convention exists to prevent.

---

## The order to build it in

Each step ships alone and leaves the tree passing.

1. **The descriptor.** `Surface` grows `stem`, `scope`, `namespaces`, `nav`,
   `requiresModule`; both entries filled in; the layouts read it instead of
   their literals.
   **Done when** `npm run bundle` shows no route heavier than before — the
   namespace lists are the risk, and the measurement is the point.
2. **`SurfaceShell`.** Both layouts become a call to it.
   **Done when** the dashboard and the desk render byte-identically and
   `desk.e2e.ts` passes untouched.
3. **The links contract** — `home()`, `signIn()`, `notifications()`,
   `supports(kind)`; `sign-in-form.tsx` takes its destination as a prop.
   **Done when** a deep link into `/desk` that bounces through sign-in comes
   back to `/desk`.
4. **The badge slot** on `NavMainItem` — `badge?: { count: number }`,
   right-aligned where `ComingSoon` sits — wired to counts the screens already
   query (`reservation.day`, `housekeeping.board`) and to
   [notifications.md](notifications.md) § 4 `unreadCount` if that has shipped
   by then. It is the one step that may wait.
5. **`docs/guides/surfaces.md`**, and delete this file.

**Shipped out of order:** the desk sidebar itself — `config/surface-nav.ts`,
the `ui/sidebar` frame, groups, role-gated Setup, the property switcher,
`NavUser` in the footer, collapse from the `sidebar_state` cookie, the
duplicated `desk.json` keys deleted — landed ahead of steps 1–3 above, wired
directly into the desk's existing layout rather than through the descriptor and
`SurfaceShell` those steps still describe. `docs/history.md` has the entry;
§ 1 has the file:line evidence.

Then the pass a phase ends with. The thing to measure is the shared chunk: this
plan moves a shell into one file and a nav into another, and both are imported
by every route on both surfaces. Measure, change one thing, measure again.
