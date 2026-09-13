# Editions — an env-selected UI and feature preset

Plan, not implementation. Not yet approved; if it survives review it
becomes `docs/plans/editions.md` and carries no status, per the doc conventions.
Date: 2026-09-13. Code read only, no builds run.

Companion files: `mvp-analysis.md` (functional coverage), `ui-analysis.md`
(interface critique — the layout problem this plan also fixes).

---

## 1. The request, restated precisely

One install, two (or more) presets chosen by an environment variable:

- **basic** — exactly what ships today. No visual change, no behaviour change.
- **a second preset** — turns more features on out of the box, and wears its own
  shell: its own layouts, its own chrome, its own widgets.

Three separable things are bundled in that sentence, and they have different
costs and different risks. Keeping them separate is most of the design:

| | What it controls | Risk |
|---|---|---|
| **A. Feature defaults** | which modules are on for a new organization | **Low** — the mechanism already exists |
| **B. The shell** | layout chrome, content width, navigation shape, density | Medium — bundle size |
| **C. Widget variants** | a different implementation of a named widget | **High** — this is where systems like this rot |

Recommendation: build A and B. Defer C until two editions genuinely need a
different implementation of the *same* widget, which is not true today.

---

## 2. Half of this already exists

`src/features/organizations/model/registry.ts` is exactly the right shape and
should be the model for the rest:

```ts
export const ORG_MODULE_REGISTRY = {
  OVERVIEW:   { label: "Overview",   icon: "LayoutDashboard", segment: "",           core: true },
  DIRECTORY:  { label: "Directory",  icon: "Contact",         segment: "directory",  enabledByDefault: false },
  FRONT_DESK: { label: "Front desk", icon: "CalendarRange",   segment: "front-desk", enabledByDefault: false },
} satisfies Record<string, OrgModule>;
```

A module declares itself once; the sidebar entry, the URL segment, the roles and
the default all follow. `isOrgModuleEnabled(id, toggles)` decides, and a stored
`OrganizationModule` row exists *only to disagree with the default*.

**So "an edition opens more features" is one function signature away.** The
edition supplies the default; a stored toggle still wins over it.

```ts
// today
isOrgModuleEnabled(id, toggles)
// proposed
isOrgModuleEnabled(id, toggles, edition)
```

`registry.test.ts` already exists to extend. This is the cheapest part of the
whole plan and the part with the clearest payoff.

---

## 3. Hard constraints found while reading

These are verified, not assumed, and two of them kill obvious approaches.

1. **You cannot duplicate the route tree per edition.** Next 16's route-groups
   doc, verbatim: *"Routes in different groups should not resolve to the same
   URL path… would both resolve to `/about` and cause an error."* So
   `(basic)/dashboard/...` and `(pro)/dashboard/...` is not an option. **One
   route tree; edition-swapped components.**
2. **`template.tsx` is a reserved Next filename** with an unrelated meaning (a
   layout that re-mounts and resets client state on navigation). Do not call
   this system "templates" — the word is taken in this framework, and the
   collision would be read as a framework feature.
3. **`theme` is also taken** — `next-themes` owns it for light/dark, and
   `ui-patterns.md` § Colour as data builds on that. A third meaning would be
   ambiguous in every conversation and every prop name.
4. **Only `env.mjs` reads `process.env`** (CLAUDE.md trap, with two named
   exceptions). The variable is declared there or nowhere.
5. **`client: {}` in `env.mjs` is empty "by design"**, with a comment saying so.
   Adding the first `NEXT_PUBLIC_*` is a decision that needs a reason, and there
   is a better path (§5).
6. **The bundle floor is tracked and defended** — `roadmap.md` records 819,257
   bytes shared by every route and says anything that moves it without adding a
   screen is a regression. Shipping two shells to every route would do exactly
   that. This is the plan's main technical risk (§8).

**Naming proposal: "edition".** A product word, no collision with `theme`,
`template`, `variant` or `mode`. `APP_EDITION=basic`.

---

## 4. The rule that makes this safe

> **An edition changes defaults. It never changes permissions.**

The request says the second edition "opens other feature endpoints for
interaction". It must not do that literally. If an endpoint is reachable only
because of which UI is rendered, then:

- flipping an env var silently changes who can call what,
- the Phase 7 external REST API bypasses the UI entirely and therefore bypasses
  the gate,
- and `tests/server/` — which calls procedures directly through a caller with a
  fabricated session — would be testing a different authorization model than
  production uses.

The guards stay exactly where they are: `requirePropertyMember`,
`isOrgModuleEnabled`, and the role checks in `model/permissions.ts`. The edition
only supplies the *default value* for a module toggle that has no stored row,
and only decorates the UI. Everything remains re-checked server-side.

This is the single most important line in the plan.

---

## 5. How the edition resolves and flows

**Not** `NEXT_PUBLIC_APP_EDITION`. Resolve on the server and pass it down, which
is exactly how `locale`, `messages`, the sidebar cookie and `user` already reach
the dashboard shell:

```
env.mjs                APP_EDITION: z.enum(["basic", …]).default("basic")
config/editions.ts     EDITION_REGISTRY — data, no behaviour (like nav-items.ts)
app/(app)/dashboard/layout.tsx
                       reads env → picks the shell → provides the edition
store/edition-context  a client context for the pieces below the boundary
```

Two reasons this beats a public env var: `client: {}` stays empty as documented,
and the door stays open for a **per-organization** edition later (read from the
`Organization` row instead of the env) without changing a single consumer. That
is a plausible future for a multi-tenant product and costs nothing to preserve.

`config/editions.ts` is the right home: `architecture.md` defines `config/` as
"data, not behaviour — nav-items.ts, locales.ts". An edition registry is data.

### Registry shape

```ts
export interface Edition {
  label: string;
  /** Overrides ORG_MODULE_REGISTRY's own enabledByDefault. A stored toggle still wins. */
  modules: Partial<Record<OrgModuleId, boolean>>;
  /** Which shell draws the dashboard chrome. */
  shell: ShellId;
  /** Default content width for pages that do not state their own. */
  width: "reading" | "full";
  /** Default grid/table density; the user's own preference still wins. */
  density: Density;
}
```

Same `satisfies Record<string, Edition>` trick as the module registry, so the
ids stay literal and `EditionId` is exact.

---

## 6. The layout plan — and the bug it fixes

This is where the edition system earns its keep immediately, because the
current layout has a real defect (detail in `ui-analysis.md` §A).

`app/(app)/dashboard/layout.tsx:76`:

```tsx
<div className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</div>
```

**1024px, centred, on every dashboard route including the reservation grid.**
The grid is up to 62 columns wide; at its default density the visible width
fits 20 of the default 31 nights, on a 1280px laptop and a 2560px monitor
alike. A reading measure is being applied to the one screen the product exists
for.

### The fix, which is also the shell's first real job

Content width is a *shell* decision, not a page decision and not a global one.

1. The dashboard layout stops applying `max-w-5xl`. It renders a full-width
   `flex-1` region and nothing else.
2. A page states what it is:
   - `full` — front desk, grid, housekeeping board, any table that can be wide
   - `reading` — settings, forms, the booking card, the person page
3. The edition supplies the default for pages that state nothing, so "basic"
   can keep today's behaviour exactly while a second edition is free to be
   wide everywhere.

This is a small mechanical change with the largest single UX payoff available,
and it is testable: the existing `report` Playwright project screenshots every
screen, so a before/after is one command.

### Shell anatomy

A shell owns four things and nothing else:

| | basic (today) | example second shell |
|---|---|---|
| Navigation | expanding sidebar, ~256px | icon rail, ~56px, labels on hover |
| Header | 56px bar with a sidebar trigger and nothing else | breadcrumb + global search + property switcher |
| Page chrome | `PageHeader` — `h1.text-2xl` + description, ~120px | title merged into the toolbar row |
| Content width | `reading` everywhere | `full` for operational routes |

A shell must not know about reservations, housekeeping or any domain. It draws
chrome and renders `children` — the same rule `app-sidebar.tsx` already states
about itself: *"The frame knows how to pick a level; it does not know what any
feature needs."*

---

## 7. Rollout — five steps, each independently shippable

Deliberately ordered so value lands before the abstraction does, and so any
step can be the last one without leaving a half-built system.

**Step 1 — Split width from the layout.** No edition system at all. Pages opt
into `full` or `reading`; the front desk becomes `full`. Fixes today's defect.
Measure with `npm run bundle` and re-screenshot. *This is worth doing whether
or not the rest of the plan is approved.*

**Step 2 — Introduce the edition, with exactly one edition.** `APP_EDITION` in
`env.mjs`, `config/editions.ts` with only `basic`, resolved in the dashboard
layout, provided through context. **Zero visual change** — the existing 20 e2e
journeys and 36 screenshots are the proof. An abstraction with one
implementation is cheap to delete if the plan stalls here.

**Step 3 — Module defaults.** `isOrgModuleEnabled(id, toggles, edition)`, plus
cases in `registry.test.ts`: a stored toggle beats the edition; the edition
beats `enabledByDefault`; `core` beats everything. Pure `model/` work, no
database, which is the property that makes it worth doing first — "the rule
before the router".

**Step 4 — The second shell.** Only now, and only after §8's bundle question
has an answer. The e2e suite runs against both editions; the `report` project
captures both, which is a genuinely good fit — the screenshot report becomes
the edition's visual contract.

**Step 5 — Widget variants, if and only if needed.** A registry keyed by widget
name with a fallback to basic. Do not build this speculatively. The moment it
exists, every widget acquires an invisible question ("which edition is this
for?") and the codebase gets harder to read for everyone.

---

## 8. Risks, honestly

**Bundle size is the real one.** Two shells statically imported means every
route carries both, and `roadmap.md` treats that as a regression by definition.
A runtime conditional does not tree-shake. Options, in order of preference:

1. Keep shells as Server Components at the top and ensure the inactive shell's
   client components are never referenced across a client boundary. Needs
   verifying with `npm run bundle`, not assuming.
2. `next/dynamic` for the shell body.
3. Accept it and re-record the floor with a written reason.

The honest answer is that this must be *measured* before step 4 starts — which
is what `roadmap.md` § How a phase ends already demands: measure the thing,
change one thing, measure again.

**Testing surface doubles.** `APP_EDITION` must be set in the e2e environment,
and a second edition means a second pass of every journey. Mitigation: only the
shell-sensitive journeys need running twice; the domain journeys do not care.

**Divergence.** Two shells drift, and the second one silently stops getting
fixes. Mitigation: shells own chrome only. If a bug can live in a shell, the
shell is doing too much.

**One more mechanism to learn.** The codebase already has module toggles, roles,
locales and themes. An edition is a fifth axis. It earns its place only if a
second edition is actually wanted — if the real goal is just "the front desk
should be wider and denser", **Step 1 alone delivers that** and the rest is
unnecessary. Worth deciding before starting.

---

## 9. Two bugs found while tracing this

Both are independent of the plan and worth fixing regardless.

1. **The sidebar is not translated.** `ORG_MODULE_REGISTRY` carries
   `label: "Overview"`, `"Front desk"`, `"Directory"` as English literals;
   `accountNavItems` does the same; `NavMain` renders `item.title` raw. Only
   `nav-user.tsx` calls `useTranslations`. So with the Russian locale active,
   **the entire sidebar stays in English** — visible in the committed
   screenshots. This contradicts `ui-patterns.md` § Strings ("every
   user-visible string comes from `messages/…`, never from a literal in a
   component"), and `locale.e2e.ts` evidently does not assert on the nav.
   Fix: the registry carries a message *key*, and the renderer resolves it.
   **Relevant to this plan**: an edition registry would otherwise repeat the
   same mistake in a second file.
2. **`max-w-5xl` on the reservation grid** — §6 above.

---

## 10. Open questions for you

1. **Is a second edition actually wanted, or is the goal "make the front desk
   wide and dense"?** If the latter, do Step 1 and stop. This is the question
   that decides whether the other four steps exist.
2. What distinguishes the second edition — is it *more features* (a
   full-service hotel vs. a small guesthouse), *a different user* (manager
   console vs. front desk terminal), or *a different customer* (white-label)?
   Each implies a different split, and the registry shape above assumes the
   first.
3. Where do shells live? `components/layout/<shell>/` nests inside a directory
   `architecture.md` already documents as "the shell" — but the standing rule is
   that new component directories do not get invented. Needs confirming against
   the guide before any file is created.
4. Should the edition eventually be **per organization** rather than per
   install? The design above keeps that possible at no cost; worth saying out
   loud now so the context is not built in a way that forecloses it.
