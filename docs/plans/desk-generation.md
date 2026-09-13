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

Two shells exist. They are 100 and 110 lines, they share about seventy per cent
of their shape, and every shared line is written twice:

| | `dashboard/layout.tsx` | `desk/[orgSlug]/[propertySlug]/layout.tsx` |
|---|---|---|
| Session guard | `getSession` → `/sign-in` | the same, copied |
| Organisation | — | `organizationBySlug` + `notFound()` |
| Module gate | — | `isOrgModuleEnabled("FRONT_DESK")` |
| Locale + messages | 15 namespaces, hand-listed | 12 namespaces, hand-listed |
| Theme | not read — `basic` has one | `toTheme("desk", cookie)` |
| Providers | `NextIntl` → `NiceModal` | `NextIntl` → `SurfaceLinks` → `NiceModal` |
| Chrome | `SidebarProvider` + `AppSidebar` + header | a bare `<aside>` + `DeskBar` |
| Stamp | `data-surface` on `SidebarProvider` | `data-surface` + `data-theme` on a `div` |

The registry is honest about what it knows and it knows very little.
`config/surfaces.ts` carries `{ id, themes, base }` and nothing else — not the
route it lives at, not its nav, not the namespaces it renders, not the module it
requires. Everything a surface actually *is* lives in its layout file, which is
why a second one is a copy.

### The desk sidebar, specifically

`features/desk/client/components/desk-nav.tsx:23` is a `SECTIONS` array of six
flat entries and a `map`. Beside it, `config/nav-items.ts` + `nav-main.tsx`
give the dashboard: groups with labels, sub-items, collapse-to-icon with
dropdown fallback, tooltips at icon width, role gating as a field, module gating
from `ORG_MODULE_REGISTRY`, active state from the pathname, a `Soon` badge, a
switcher in the header and the signed-in person in the footer.

The desk has none of it. Concretely, and each of these is a defect rather than a
difference in taste:

- **You cannot sign out from the desk.** `NavUser` holds `signOut`, and the desk
  has no footer. A receptionist ending a shift has to navigate to the dashboard.
- **There is no property switcher.** A management company with four hotels has
  to edit the URL. `dashboard-header.md` § Still open names this and leaves it
  there.
- **There is no link to Setup.** `/front-desk/<property>/setup` exists only on
  the dashboard, so a manager adding a room type leaves the surface —
  `app/desk/**` has nine pages and `setup` is not one of them.
- **Nothing is gated.** Setup is manager-only, which the dashboard expresses as
  a `roles` field and the desk cannot express at all.
- **Nothing is grouped.** Six peers in one column, and the next three sections
  make it nine. The dashboard solved this with `NavGroup` before it had six.
- **It does not collapse and it does not persist.** `components/ui/sidebar.tsx`
  already writes `sidebar_state` and binds ⌘B; the hand-rolled `<aside>` reaches
  none of it, and on a tablet in portrait the rail eats a column of the grid.
- **`messages/en/desk.json` carries `nav.*` and `section.*` with identical
  words**, because the nav and the bar each grew their own key set.

One of these is not a defect, and the plan must not quietly reverse it. The desk
layout says, in a comment that is a decision: *"Sections always visible, never
collapsed to a rail. A receptionist moves between five of them all day; a rail
costs a hover every time."* That is right, and § 3 keeps it — as a **default**,
which is what it was always about, not as a prohibition on the control.

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
  /** Which `messages/<locale>/*.json` its screens read. § 4. */
  namespaces: MessageNamespace[];
  /** Which nav builder draws it — an id, resolved client side. § 3. */
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

## 3. The desk sidebar becomes the dashboard's, without becoming the dashboard

**The nav is data and is shared. The renderer belongs to the base.** That single
sentence is the whole design, and it is already the precedent in the tree:
`config/nav-items.ts` is data with string icon names and role fields, and
`nav-main.tsx` is a shadcn renderer that draws it.

So:

- **`config/surface-nav.ts`** holds `deskNavItems(orgSlug, propertySlug, role,
  toggles): NavGroup[]`, beside `accountNavItems` and `organizationNavItems`,
  reusing the `NavGroup` / `NavMainItem` types unchanged. Icons are looked up
  through a map keyed by string — `ORG_ICONS` is the pattern — so
  `config/surfaces.ts` itself stays free of component imports.
- **The renderer is `NavMain`**, unchanged, because the desk is `base: "shadcn"`
  and sharing a renderer between two surfaces on *one* base is not the thing the
  rule forbids. A surface on Bootstrap writes its own renderer over the same
  `NavGroup[]`, and the fact that it can is the test of whether this split is
  right.
- **The frame is `components/ui/sidebar`**, replacing the hand-rolled `<aside>`:
  `SidebarProvider` + `Sidebar` + `SidebarHeader/Content/Footer`. The desk
  inherits `sidebar_state`, ⌘B, the mobile sheet and tooltips for nothing.

The groups, which is the design work:

| Group | Items |
|---|---|
| *(back)* | ← the organisation's dashboard — the icon button now in `DeskBar` |
| **Front desk** | Grid · Today · Bookings |
| **Rooms** | Rooms · Housekeeping |
| **Guests** | Guests |
| **Setup** | Setup — `roles: [OWNER, ADMIN]`, and a `/desk/**/setup` route so it does not send a manager to the dashboard |

- **Header: a property switcher**, the shape of `OrganizationSwitcher`, listing
  the properties of this organisation the caller may see. It needs no new
  procedure — `property.list` exists — which is the test `second-surface.md`
  sets for whether something belongs in a surface plan at all.
- **Footer: `NavUser`**, so signing out is possible from the desk. The locale
  control it carries is the one `dashboard-header.md` § 2 wants deleted in
  favour of a header control; the desk already has `DeskLocale` in its bar, so
  on this surface the footer renders the account half only. Decide it once,
  there, rather than shipping two language controls on one screen.
- **Collapse: allowed, expanded by default, remembered per person.**
  `collapsible="icon"` with `defaultOpen` read from `sidebar_state` on the
  server. This *is* the documented decision, kept: the default is what the
  comment was defending, and a receptionist who collapses it has said something
  about their screen that the comment cannot know. The comment in
  `desk/layout.tsx` gets rewritten in the same commit — a decision that has
  moved and a comment that has not is worse than neither.
- **A badge slot on `NavMainItem`** — `badge?: { count: number }` — rendered
  right-aligned, the `ComingSoon` element's position. Arrivals due today, dirty
  rooms, unread notifications. It is one optional field and it is what turns a
  sidebar into an instrument; without it the desk's nav is a list of URLs.
  Counts come from queries the screens already run
  (`reservation.day`, `housekeeping.board`,
  [notifications.md](notifications.md) § 4 `unreadCount`), cached with the
  30-second `staleTime` the shell already uses.

**Strings.** `desk.json` loses the duplicated `section.*` block; nav and bar
read one key each. `message-keys.test.ts` fails on the first orphan, which is
what makes this a step rather than a hope.

## 4. The shell, written once

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

## 5. Everything common, and where it is configured

The checklist a new desk touches, in the order it touches it. This is the
section the guide in § 7 is condensed from.

| What | Where | Note |
|---|---|---|
| The registry entry | `config/surfaces.ts` | § 2. TypeScript names the missing fields |
| The route | `app/<stem>/…/layout.tsx` | a real segment, never a route group |
| The nav | `config/surface-nav.ts` | data; icons by string |
| The links | `store/surface-links.tsx` | `stem` + `directory` today; § 5.1 |
| The styles | `styles/<surface>.css`, imported in `index.scss` | after the blocks it overrides |
| The theme | `SURFACES[id].themes` + `shell.theme.<id>` in both locales | label by convention, not a field |
| The strings | `namespaces` on the descriptor | narrow, and measure |
| The lint zone | `FEATURES` in `eslint.config.mjs` | **a feature not listed is unguarded** |
| The screens | `features/<surface>/client/components/` | only if the base differs |

Two of those rows deserve more than a line.

### 5.1 The links contract is the load-bearing one

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

### 5.2 The lint zone is the one that fails silently

`architecture.md`: zones are written per feature because the rule does not
expand a glob in `target`, and **a zone that matches nothing reports nothing,
which is worse than no rule at all.** A new surface feature absent from
`FEATURES` in `eslint.config.mjs` is a client directory free to import a
`server/`, and the build will not say so. It belongs in the § 7 checklist in
bold, and it belongs in the same commit as the directory.

## 6. What this does not do

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

## 7. The compact guide, written last

When the steps below are done, one new file: **`docs/guides/surfaces.md`** —
*Adding a surface*. Compact on purpose, one screen, no prose about why:

1. The § 5 table as a checklist, in order, with the lint zone in bold.
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
4. **The desk sidebar.** `config/surface-nav.ts`, the `ui/sidebar` frame,
   groups, roles, the property switcher, `NavUser` in the footer, collapse from
   the cookie, the duplicated `desk.json` keys deleted.
   **Done when** a MEMBER sees no Setup entry, an ADMIN reaches setup without
   leaving the surface, sign-out works from the desk, and the collapsed state
   survives a refresh.
5. **The badge slot**, wired to the counts that already exist — and to
   [notifications.md](notifications.md) § 4 if that has shipped by then. It is
   the one step that may wait.
6. **`docs/guides/surfaces.md`**, and delete this file.

Then the pass a phase ends with. The thing to measure is the shared chunk: this
plan moves a shell into one file and a nav into another, and both are imported
by every route on both surfaces. Measure, change one thing, measure again.
