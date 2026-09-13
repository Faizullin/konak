# The dashboard header, and the theming seam under it

Two things, and the second is why the first is worth planning rather than just
writing. The dashboard's header is empty and wants a language switcher, an
inbox and an appearance control. An appearance control needs something to
control, and what it should control is a seam this codebase has already started
building and never switched on: **a surface wears a theme.**

`basic` is the dashboard. `desk` is the second surface
([mvp-roadmap.md](mvp-roadmap.md)). A `desk2` should be able to arrive later
with its own themes — and, if it comes to it, its own CSS base — without any
existing surface being edited. This plan fixes the shape that makes that a
registry entry, and implements **exactly one base (shadcn) and one theme per
surface**, because that is all there is evidence for today.

**Scope.** No file under `src/app/desk/` or `src/features/desk/` is edited. The
desk's rule is that nothing existing changes; the reverse holds here. The desk
still gains dark mode in Phase 1, because the palette it already carries starts
rendering — that is a stylesheet waking up, not an edit.

---

## 1. What is there today, verified

**The header is two elements.** `src/app/(app)/dashboard/layout.tsx:73-76`:

```tsx
<header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
  <SidebarTrigger className="-ml-1" />
  <Separator orientation="vertical" className="mr-2 h-4" />
</header>
```

56px of border, and a separator that separates nothing from nothing.

**Half the theming seam exists.** `src/styles/desk.css:29` scopes a whole token
block to `[data-surface="desk"]`, stamped by
`src/app/desk/[orgSlug]/[propertySlug]/layout.tsx:89`, with the comment that
says the architecture out loud: *"Everything here is a token. No component
names a colour, so a second treatment later is another block like this one
rather than a second set of components."* That is the right idea and this plan
is mostly about finishing it.

**The other half has never run.** `next-themes` has been a dependency since the
template, `globals.css` declares `@custom-variant dark (&:is(.dark *))`, and
hundreds of `dark:` utilities are written across the product — but **no
`ThemeProvider` is mounted anywhere**, so `.dark` has never been on `<html>`.
Two things in the repo say so:

- `src/components/ui/sonner.tsx:12` calls `useTheme()` outside any provider and
  falls back to `"system"`; toasts have never followed anything.
- `tests/e2e/report/capture.e2e.ts:78-84` adds the class by hand, with the
  comment *"Dark mode is a class variant and nothing in the product sets it
  yet."* Every dark screenshot in `docs/screenshots-report/` was taken that way.

So `src/styles/desk.css:67` — `[data-surface="desk"]:is(.dark, .dark *)`, a
full dark palette for the desk — is dead code that has never painted a pixel.

**Language already works**, in `nav-user.tsx:127-138`: a cookie write and
`router.refresh()`, because there is no locale in the URL. `switchLanguage()` in
`tests/e2e/locale.e2e.ts:67` drives it through the sidebar's user menu.

**Preferences have two precedents that disagree, each with a reason.**
`konak.locale` and `sidebar_state` are cookies the *server* reads on first
render; `konak.desk.<propertyId>` (`use-desk-preferences.ts`) is `localStorage`,
because density belongs to a screen rather than to a person.

---

## 2. The model: three axes

Written as a table because the whole design is keeping them apart.

| Axis | Carried by | Set by | Scope of the choice | Today |
|---|---|---|---|---|
| **Surface** | `data-surface` on the surface's root element | that surface's layout, from the route | not a choice — you are where you navigated | `desk` stamps it; `basic` stamps nothing |
| **Colour scheme** | `.dark` on `<html>` | `next-themes` | one per person, whole install | never set |
| **Theme** | `data-theme` beside `data-surface` | a control, remembered per surface | one per surface, per person | does not exist; each surface has one palette |
| *(CSS base)* | which stylesheet a surface's components are written against | that surface's layout | one per surface, fixed at build | `shadcn` only |

**The selector shape is fixed now**, and it is the one `desk.css` already uses:

```css
[data-surface="desk"]                       { /* its default theme, light */ }
[data-surface="desk"]:is(.dark, .dark *)    { /* …the same theme, dark      */ }
[data-surface="desk"][data-theme="slate"]   { /* a second theme, when one exists */ }
```

Adding a theme is then **a CSS block and a registry line**. No component
changes, because no component names a colour — which is the rule `desk.css`
already states and `ui-analysis.md` §4 says the grid still breaks.

**Colour scheme is install-wide, theme is per surface.** Light or dark is about
the room a person is sitting in, and following them from the dashboard to the
desk is what they expect. Which palette a surface wears is about that surface.
One `next-themes` provider at the root, one stored theme id per surface.

**"Edition" is a different axis and keeps its own word.**
`../ui-refactor-notes/edition-system-plan.md` proposes an env-selected preset
that decides which modules are on and which shell draws them. If it is ever
built, an edition *chooses a surface*; a surface *declares its themes*. Neither
subsumes the other, and the two words are not interchangeable.

---

## 3. Constraints found while reading

Verified, not assumed. Three of them kill obvious approaches.

1. **`system` cannot be resolved on the server.** The `dark` variant is
   class-based, so "follow the OS" needs a class on `<html>` before paint, and
   only client JS knows what the OS wants. A cookie alone would have to store
   `light`/`dark` and lose `system` entirely.
2. **`next-themes` is already in the shared bundle**, dragged there by
   `sonner.tsx` inside `components/layout/providers.tsx`. Mounting its provider
   adds the provider, not the library. Its API (0.4.6, `dist/index.d.ts`)
   carries exactly what this needs: `themes`, `attribute` (`class`, any
   `data-*`, or an array of both), `value`, `storageKey`, `forcedTheme`.
3. **`<html>` needs `suppressHydrationWarning`** once a script writes a class on
   it before React hydrates, or every page logs a mismatch.
4. **A stylesheet imported by a layout is never unloaded.** Next 16's CSS guide,
   verbatim: *"Global styles can be imported into any layout, page, or component
   inside the `app` directory. However, since Next.js uses React's built-in
   support for stylesheets to integrate with Suspense, this currently does not
   remove stylesheets as you navigate between routes which can lead to
   conflicts."* So importing a second CSS base in `app/desk2/layout.tsx` is a
   **load-order optimisation, not a scope** — after one client-side navigation
   it is on the dashboard's pages too. Isolation has to be written into the CSS.
5. **Importing one is otherwise allowed and documented** — the same guide's
   external-stylesheets example is literally
   `import 'bootstrap/dist/css/bootstrap.css'` in a layout. And `sass` is
   already a devDependency, so a base can be wrapped in a selector at build time
   rather than shipped raw.
6. **`experimental.cssChunking`** is the knob if cross-surface load order ever
   misbehaves: `true` by default, `'graph'` on Turbopack.
7. **`src/app/layout.tsx:29` hardcodes `lang="en"`** while the locale is a
   cookie. Unrelated bug, adjacent line, one fix — `await getLocale()`.
8. **`message-keys.test.ts` fails on an unread message.** Any string added here
   has to be reached by a `t(…)` call in `src/`; a key built as
   ``t(`theme.${id}`)`` counts, because the scan treats a template as a prefix.
9. **`app/` holds routing and nothing else** (`architecture.md`). A header with
   three popovers in it is a component, not a layout.
10. **A shell must not know a domain.** The header is chrome; an inbox's
    contents are not. That seam decides where the bell's body lives.
11. **The bundle floor is defended** — 819,257 shared bytes, `roadmap.md`
    § How a phase ends.

---

## 4. Decisions

### 4.1 `next-themes` for the colour scheme, not a cookie

Against the house habit of cookies, for one reason: constraint 1. A preference
that cannot express `system` is worse than none, and resolving `system` on the
client is re-implementing the library that is already installed and already
being waited for by `sonner.tsx`.

Mounted in `components/layout/providers.tsx` — already `"use client"`, already
the parent of the only consumer — as `attribute="class"`,
`defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`,
`storageKey="konak.theme"`. Named like `konak.locale` and `konak.desk.*` rather
than the library's bare `theme`.

At the root, so `/desk`, `/sign-in` and the landing page get the scheme from the
same change without one of their files being edited.

**The rule for anything added later:** a preference that needs no OS resolution
— a theme id, a density, an accent — goes in a cookie read by the layout, like
`sidebar_state`. The colour scheme is the exception and carries its reason.

### 4.2 `basic` stamps `data-surface` too

The dashboard inherits `:root` today, so "stock shadcn" is implicit and `desk`
is the special case. Stamping `data-surface="basic"` on the dashboard shell
makes the axis uniform: every surface names itself, registry ids map 1:1 onto
attribute values, and basic's second theme is later a CSS block instead of a
CSS block *plus* a layout edit.

No `basic.css` is written until there is something to put in it. An empty block
asserts a theme that does not exist — the argument this codebase already makes
about empty barrels and empty route groups.

`globals.css` stays untouched: it is shadcn's, the CLI rewrites it, and `:root`
remains the stock defaults every surface starts from.

### 4.3 One theme per surface today, so no theme control ships

`SURFACES` (§4.4) declares `themes` per surface. Today every surface has exactly
one, so the appearance popover renders the scheme control and **nothing else** —
the theme row appears the day a surface has two, from the same code. That is
what "extensible but defined for basic shadcn only" means in practice: the
registry, the selector shape and the control all exist; the data has one row.

### 4.4 The registry is data, in `config/`

`src/config/surfaces.ts`, in the shape `nav-items.ts` and `locales.ts` already
have — `satisfies Record<string, Surface>` so the ids stay literal:

```ts
export interface Surface {
  /** The `data-surface` value its layout stamps. */
  id: string;
  /** Every theme it can wear. One entry means no theme control is drawn. */
  themes: { id: string; labelKey: string }[];
  /** Where its theme choice is remembered. Absent while it has one theme. */
  storageKey?: string;
  /** The CSS base its components are written against. */
  base: "shadcn";
}
```

`base` exists from the first day with exactly one legal value. It is the field
that makes §4.5's rule checkable rather than a paragraph nobody reads.

### 4.5 A surface with its own CSS base owns its own components

The expensive axis, stated before anyone reaches for it. `components/ui/*` is
shadcn and Tailwind and stays that way. A `desk2` on Bootstrap does not re-skin
those; it has `features/desk2/client/components/` written against its own base.
**No component is written to serve two bases** — that is the rule, and the
edition plan's §C names the same failure in the same place: a shared widget with
an invisible "which system is this for?" question is where this kind of
architecture rots.

Which is why the theme axis is built now and the base axis is only designed: one
is a CSS block, the other is a second component library.

### 4.6 Density is not in the popover

`use-desk-preferences.ts` already owns density, per property, in that browser,
with a written argument for why it is not a user setting. A second global
density would be a second source of truth that disagrees with the first on the
one screen either matters on.

### 4.7 The inbox stays in the shell while it is fake

A `features/notifications/` with no router, no model two sides agree on and no
rows asserts a feature that does not exist. The bell and its demo items live in
the header directory with the real source named in a comment; when a
`notification` router exists the component moves to
`features/notifications/client/components/` and the header's import changes.

### 4.8 Where the files go

`components/layout/dashboard/header/`, mirroring the `sidebar/` directory beside
it — a directory per shell region is following the documented shape rather than
inventing one. (The standing rule is that component directories are not
invented; this is the plan's one judgement call, and the alternative is four
flat files in `components/layout/dashboard/`.)

---

## 5. The header, composed

```
[ trigger ] [ sep ]                          [ locale ] [ bell ] [ appearance ]
```

`h-14` and the border stay; the left side keeps a slot for the breadcrumb that
does not exist yet (§9). Three icon buttons, `variant="ghost" size="sm"`, each
with an `aria-label` from messages — the bell's label carries the count
("Inbox, 3 unread"), because a badge is not an accessible name.

The header takes `surface` as a prop from the layout that renders it. Derived
from the route, never from state — the rule `app-sidebar.tsx` already follows
for which nav level to draw. No new context until something deep needs one.

Semantic tokens only in every new component — `bg-popover`,
`text-muted-foreground`, `border`, `bg-primary`, never a literal `bg-sky-100`.
That is what makes a theme choice move them at all.

---

## 6. Phases

Six are built, in order, each shippable alone. Two more are designed and
deliberately not scheduled.

### Phase 1 — The colour scheme becomes real

`ThemeProvider` in `providers.tsx`; `suppressHydrationWarning` and
`lang={locale}` on `<html>` (constraint 7). No control yet.

The visible change is that a machine set to dark renders dark — on both
surfaces, because `desk.css:67` has been waiting for it. Toasts start following
the scheme, a bug fixed in passing.

**Done when** `<html>` carries `dark` on an OS set to dark, no hydration warning
appears, `npm run bundle` has been re-run, and the 36 screenshots prove light is
unchanged.

### Phase 2 — The header becomes a component

`header/app-header.tsx`, `"use client"`, rendering exactly what lines 73-76
render today, imported by the layout. The layout goes back to routing.

**Done when** the screenshots are byte-identical.

### Phase 3 — Language moves into the header

`header/header-locale.tsx`: the cookie write and `router.refresh()` from
`nav-user.tsx`, as an icon button with the locale code beside it. Delete
`chooseLocale` and lines 127-138 from `nav-user.tsx` — one switcher for the
dashboard, not two — and move `switchLanguage()` in `tests/e2e/locale.e2e.ts:67-72`
onto the new control.

**Done when** `locale.e2e.ts` passes, changed only in how it clicks.

### Phase 4 — The surface registry, and `data-surface="basic"`

`config/surfaces.ts` with two entries, one theme each; the dashboard shell
stamps its id. Pure data plus one attribute: nothing renders differently, and
`npm test` gains a case pinning that every surface's themes are non-empty and
every id is unique.

**Done when** both surfaces name themselves in the DOM and the screenshots are
byte-identical.

### Phase 5 — The appearance control

`header/header-appearance.tsx`: a popover with three radio items — System ·
Light · Dark, `Monitor` / `Sun` / `Moon` — reading and writing `useTheme()`, and
a theme row that renders only when `SURFACES[surface].themes.length > 1`, which
is false everywhere today. `config/appearance.ts` holds the three scheme ids
with their icon and label keys, as data, like `config/locales.ts`.

The one trap: `theme` is `undefined` on the server and on the first client pass,
so the tick must render from `resolvedTheme` **after mount** or the popover
hydrates with the wrong item marked. `useDeskPreferences` solves the same
problem the same way — defaults first, stored value in an effect.

**Done when** Dark paints the whole dashboard dark, survives a reload, System
follows the OS changing while the tab is open, and the theme row is provably
absent because the data says so rather than because it was not written.

### Phase 6 — The bell, the strings, the docs

`header/header-inbox.tsx`: a bell with an unread `Badge`, opening a popover
about 380px wide — a "Mark all read", a scrollable list grouped Today / Earlier,
and an empty state that says nothing has happened rather than looking broken.

An item is `{ id, kind, title, body?, at, read, href? }` where `kind` is
`arrival | departure | channel | housekeeping | payment` and decides the icon.
Times through `useFormatter()`, like `attachment-table.tsx`. Read state is
`useState`: it is demo data, and pretending otherwise is worse than admitting
it. One constant, `INBOX_DEMO`, with a comment naming what replaces it — today's
arrivals and departures are already one query the desk makes
(`reservation.day`), channel bookings land through `channels/server/inbound.ts`,
and a dead-lettered outbox row is the third candidate.

Then the strings: one namespace, `messages/{en,ru}/shell.json`, added to
`messages/*/index.ts` and to the dashboard layout's provider list. One rather
than two because both are chrome on every dashboard route, and `nav`/`pages` are
the precedent for a namespace that is not a feature.

Then the docs: a **The header** section in `ui-patterns.md` beside § The
sidebar, saying where a shell control goes; a § Surfaces and themes section
recording the three axes and the selector shape, because that is now how this
product is themed and a guide describes how things are; a paragraph in
`handoff.md`; the entry in `history.md`. And the stale comment in
`capture.e2e.ts:78-84` — the product sets the class now.

**Done when** `npm run lint && npm test && npx tsc --noEmit && npm run format:check`
pass, `npm run build` passes because routing moved, and the guides describe what
is in the tree.

---

### Phase 7 — A second theme for one surface *(not scheduled)*

The proof that §2 is real, and the cheapest thing in this document once the
above lands: a `[data-surface="basic"][data-theme="…"]` block in
`styles/basic.css`, its light and dark halves, and one line in `SURFACES`. The
theme row in the popover appears on its own, a `storageKey` is added for that
surface, and the choice is a cookie read by the layout (§4.1's rule) so the
first paint is right.

**Do not build this speculatively.** Build it the day somebody asks what the
dashboard would look like in another palette — at which point it is an
afternoon, which is the entire point of the four phases above.

### Phase 8 — A surface with its own CSS base *(designed, not scheduled)*

What a `desk2` on Bootstrap actually costs, so the decision is made with the
price visible.

1. **Its own route group and layout**, `app/desk2/`, stamping
   `data-surface="desk2"`, `base: "bootstrap"` in the registry.
2. **The base is wrapped, not imported raw.** `sass` is already a devDependency,
   so `styles/desk2.scss` nests the vendor stylesheet inside
   `[data-surface="desk2"] { … }` at build time. Importing
   `bootstrap/dist/css/bootstrap.css` in the layout is documented and legal
   (constraint 5) but does not scope anything: constraint 4 means it is still
   loaded on the dashboard after one client-side navigation.
3. **The resets are the hard part**, and this is the honest warning. Tailwind's
   preflight and Bootstrap's Reboot are both global resets of `html`, `body` and
   every element. Wrapping neuters Reboot's element selectors inside the
   surface, which is what is wanted, but any rule targeting `html`/`body`
   survives or dies unpredictably. Budget for the reset layer, not for the
   components.
4. **Its own components** (§4.5). This, not the stylesheet, is the real cost.
5. **Measure before, measure after** — `roadmap.md` § How a phase ends, and the
   bundle floor is a documented regression test.

**Decide first, with `npm run bundle` output in hand:** is a second CSS base
actually wanted, or is the goal "a surface that looks different"? Phase 7
delivers the second for an afternoon. Phase 8 is a second component library, and
the two are not close in price.

---

## 7. Risks

**Hydration, twice.** On `<html>` (constraint 3) and in the popover (Phase 5).
Same class of bug, both with a known shape.

**Every dark screenshot in the repo becomes reachable a second way.** They were
taken with an injected class; they will be taken with a real preference. If any
differ, the difference is a bug this work uncovered, not one it caused — and the
desk's dark palette in particular has never been looked at by anyone.

**The inline script.** `next-themes` injects a blocking script: that is the cost
of no flash, and it is ~1 kB of HTML per response rather than bundle. Measure
anyway and re-record the floor with a reason if it moves.

**`message-keys.test.ts`** fails on the first string added and not read — which
is why the strings are a named step rather than an afterthought.

**The registry outliving its use.** If Phase 7 never happens, `config/surfaces.ts`
is a file with two rows and one field that never varies. That is a cheap thing
to delete, and it is deliberately the only thing this plan builds ahead of
demand.

---

## 8. What this does not do

- Touch `app/desk/` or `features/desk/`. The desk's palette starts rendering in
  Phase 1 because a stylesheet wakes up, not because a file changed.
- Repaint `STATUS_CLASS` or any grid colour — `roadmap.md` Phase 12, and
  `../ui-refactor-notes/ui-analysis.md` §4 for why it is currently unthemeable.
- Add a second density, or move the desk's.
- Add a `Notification` model, a router, or read state that outlives a tab.
- Add a breadcrumb, a global search, or a property switcher to the header.
- Decide anything about editions. That is a different axis and a different plan.

---

## 9. Open questions

1. **Language: move it, or keep both?** The plan moves it out of the sidebar's
   user menu, because two controls for one setting is how they drift. Keeping
   both is a one-line difference and leaves `locale.e2e.ts` alone.
2. **Is a second CSS base actually wanted, or a second look?** Phase 7 against
   Phase 8, and the answer decides whether `base` in the registry ever holds a
   second value.
3. **Should the bell be real instead of demo?** Today's arrivals and departures
   are the cheapest honest source — `reservation.day` is already queried by the
   desk. The demo is right only if the bell is being shown before it is used.
4. **A breadcrumb on the left?** The header is otherwise empty on that side, and
   the shell is being opened exactly once. Out of scope as written.
