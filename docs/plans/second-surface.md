# A surface of its own — `desk2`, another CSS base, its own way in

What it would actually cost to add a surface that does **not** look like this
product: its own stylesheet base (Bootstrap, Ant, anything), its own components,
and its own sign-in and sign-up screens.

`/desk` proved the cheap half of this. It has its own layout, its own token
block and its own screens, and it added no capability — every procedure it calls
already existed. What it did **not** do is bring its own CSS base, and that is
the axis this plan prices.

Read [ui-patterns.md](../guides/ui-patterns.md) § Surfaces and themes first: the
three axes and the rule about components are already binding there. This is the
plan for the one thing that is not built.

---

## First, the cheap answer, so the expensive one is a choice

**If the goal is "a surface that looks different", it is an afternoon and no new
library — and it is now proven rather than asserted.** The desk carries two
palettes, `default` and `contrast`, and adding the second was three things: a
CSS file, an import, a registry line. No component changed, because no component
names a colour. `guides/ui-patterns.md` § Adding a palette is the recipe.

```css
[data-surface="desk2"]                                   { /* its default   */ }
[data-surface="desk2"]:is(.dark, .dark *)                { /* …dark         */ }
[data-surface="desk2"][data-theme="warm"]                { /* a second one  */ }
```

Different spacing, density and radius are the same block — `--radius`, and the
grid's `--grid-night` / `--grid-lane` custom properties.

**What is *not* ready is a theme for a surface on a different base**, and that
is § 2.4 below rather than a gap in the mechanism: a `data-theme` attribute
cannot switch a compiled stylesheet.

**Only reach for § 2 if the goal is genuinely a different component library** —
because a client insists on their design system, or because a second product is
being built out of the same domain. Those are real reasons. "It should look
different" is not one of them.

---

## 1. What a surface owns

A surface is a shell, a set of screens, and the way into it. It owns:

| | |
|---|---|
| A route | `app/desk2/…`, a real segment, not a route group |
| A layout | its own guard, its own chrome, `data-surface="desk2"` |
| Its screens | `features/desk2/client/components/` |
| Its way in | its own sign-in and sign-up, if it wants them |
| A registry entry | `config/surfaces.ts` |

It owns **no** `model/`, **no** `server/` and **no** barrel. That is what
`features/desk/` looks like today and it is the shape, not an omission: a
surface adds no capability, so it has nothing to put in a `model/` and nothing
to export. If a step here needs a new procedure, the step is in the wrong plan —
it belongs in [roadmap.md](roadmap.md).

---

## 2. Its own CSS base

### 2.1 The base is wrapped, not imported

**A stylesheet imported by a layout is never unloaded.** Next 16's CSS guide,
verbatim: *"since Next.js uses React's built-in support for stylesheets to
integrate with Suspense, this currently does not remove stylesheets as you
navigate between routes which can lead to conflicts."*

So `import "bootstrap/dist/css/bootstrap.css"` in `app/desk2/layout.tsx` is a
**load-order optimisation, not a scope** — after one client-side navigation it is
on the dashboard's pages too. Isolation has to be written into the CSS.

`sass` is already a devDependency, so:

```scss
// styles/desk2.scss
[data-surface="desk2"] {
  @import "bootstrap/scss/bootstrap";
}
```

The vendor stylesheet is nested at build time. One import in `styles/index.scss`,
after the surfaces that came before it.

### 2.2 The resets are the hard part

This is the honest warning, and it is not about components.

Tailwind's preflight and Bootstrap's Reboot are both **global** resets — they
rewrite `html`, `body`, and every bare element. Wrapping neuters Reboot's element
selectors inside the surface, which is what is wanted. But any rule targeting
`html` or `body` survives the wrap or dies, unpredictably, and the two resets
disagree about box-sizing, line-height, heading margins and form control
appearance.

**Budget for the reset layer, not for the components.** Expect to write a small
`[data-surface="desk2"]` block that re-asserts what the wrap lost, and expect to
find it by looking rather than by reading.

`experimental.cssChunking` (`true` by default, `'graph'` on Turbopack) is the
knob if cross-surface load order misbehaves.

### 2.3 Its themes are a different mechanism

`Surface.base` decides how a theme is *applied*, and only `shadcn` is in
`ATTRIBUTE_THEMED` — the list `AppearanceToggle` will draw a theme row for. A
surface on Bootstrap or Ant declares its palettes the same way and switches them
a different way, because those ship **compiled** stylesheets per theme rather
than custom properties.

Two options when that day comes, and the second is almost certainly right:

- **Load both and toggle a class the vendor understands.** Simple, and it ships
  every theme's bytes to everyone.
- **Let the layout choose the stylesheet**, from the same cookie the attribute
  mechanism reads. A theme is already resolved on the server — that is the whole
  point of it being a cookie — so the layout that knows the theme is the thing
  that imports the file. Constraint 4 still applies: whatever it imports is
  never unloaded, so each theme's build must be wrapped in
  `[data-surface="desk2"][data-theme="…"]` at build time exactly as the base is.

Either way `ATTRIBUTE_THEMED` grows a second member or the control grows a
second branch — and the registry, the cookie and the label convention are
already shared.

### 2.4 A surface with its own base owns its own components

`components/ui/*` is shadcn and Tailwind and stays that way. `desk2` does not
re-skin them; it writes `features/desk2/client/components/` against its own
base.

**No component is written to serve two bases.** A shared widget carrying an
invisible *"which system is this for?"* question is where this kind of
architecture rots — and it rots quietly, because both callers keep working until
one of them needs a variant the other cannot have.

This is why `Surface.base` exists in the registry with one legal value today: it
makes the rule checkable rather than a paragraph nobody reads.

**What is still shared, and must be:** every router, every `model/`, `lib/*`,
`store/surface-links.tsx`, the message namespaces. Those are the product. What
is not shared is anything that draws.

---

## 3. Its own sign-in and sign-up

### 3.1 What is shared and what is not

**One Better Auth instance, one session, one user table.** Signing in on
`/desk2` signs you in everywhere, and that is right: it is one product, and a
person is one person. What a surface owns is the **screen**, not the identity.

So `desk2` gets `app/desk2/(auth)/sign-in/page.tsx` rendering
`features/desk2/client/components/sign-in-form.tsx`, written against its base
and calling the same `authClient`. The form is thirty lines; the identity is
untouched.

### 3.2 Three things in the way, all small

**The forms hard-code where they land.** `sign-in-form.tsx` and
`sign-up-form.tsx` both `router.push("/dashboard")`, and `(auth)/layout.tsx`
redirects an already-signed-in visitor to `/dashboard`. A surface cannot own its
own entry point while that is true — and it is the same bug class as the links
the grid used to build inline, fixed by `store/surface-links.tsx`.

The fix is the same shape: **the destination is a prop, defaulted to today's
value.** A surface's own sign-in passes its own home; nothing else changes.

**`?next=` is worth adding at the same time.** A deep link into `/desk2` that
bounces to sign-in should come back to where it was going, not to a home page.
The guard already knows the path it refused.

**Sign-up is worth questioning before it is built.** Staff accounts in a hotel
are invited, not self-registered — and a public sign-up on a property's own
surface is a stranger creating an account inside somebody's hotel. If `desk2`
wants a way in for new people, an **invitation** is almost certainly the right
shape, and that is a capability, not a surface: it belongs in
[roadmap.md](roadmap.md).

### 3.3 What a surface declares

`store/surface-links.tsx` already carries a base path and builds `grid()`,
`bookings()` and `booking()` from it. A surface with its own way in needs two
more on the same object — `home()` and `signIn()` — and then every redirect in
the product can ask instead of assuming.

---

## 4. Does `env.mjs` need a surface selection?

**No — with one narrow exception, and it is not the one people reach for.**

**Do not put the surface in the environment.** An env var choosing between two
component trees is an *edition system*, and it was already considered and
declined: it is machinery for a customer who does not exist, it costs the
bundle floor, and it makes "which code is running" un-answerable from the URL.
**Routes already select the surface.** `/dashboard`, `/desk` and `/desk2` are
three surfaces, all deployed, all reachable, and which one a person sees is
which one they opened.

The exception is **where a person lands when they have not opened anything** —
`/` and the moment after sign-in. That genuinely is a deployment choice: a hotel
installing this wants staff on the desk, not on an organisation admin screen.
One optional variable, validated:

```js
// env.mjs — keep the literal list in step with `config/surfaces.ts`.
// A pinned unit test is what keeps the two honest; `env.mjs` cannot import
// the registry, because `server/auth.ts` loads this file through jiti and
// jiti does not read tsconfig paths (see CLAUDE.md § Traps).
DEFAULT_SURFACE: z.enum(["basic", "desk"]).default("basic"),
```

Read in exactly two places — the landing route and the post-sign-in redirect —
and nowhere else. If it starts being read in a third, it has become an edition
system and the decision should be retaken deliberately.

**The better answer, when there is evidence for it:** derive the landing surface
from the person. A user whose only membership is a property staff role lands on
the desk; an owner lands on the dashboard. That needs no variable and is right
per-person rather than per-install. It is more code, and it should wait until
somebody actually has both kinds of user.

---

## 5. Order

1. **Decide § 0.** A palette is an afternoon; this plan is a component library.
   Have `npm run bundle` output in hand.
2. **The links contract** — `home()` and `signIn()` on `SurfaceLinks`, and the
   redirect destinations become props. Ships on its own, improves `/desk`
   immediately, and is a prerequisite for everything below.
3. **`app/desk2/` with `base: "shadcn"`** — a second surface that is *only* a
   different palette, to prove the registry, the layout and the links before any
   vendor CSS is involved.
4. **`styles/desk2.scss`**, the wrapped base, and the reset layer. Measure the
   bundle floor before and after.
5. **`features/desk2/client/components/`** — the screens. This is the real cost,
   and it is proportional to how many screens the surface has, not to anything
   in this document.
6. **Its own `(auth)` screens**, last, because they are the smallest and they
   depend on step 2.

---

## What this does not do

- **Change anything about identity.** One Better Auth, one session, one user.
- **Add a procedure.** If it needs one, it is not a surface.
- **Touch `/dashboard` or `/desk`.** Same rule `/desk` was built under: if a
  step here would require editing an existing surface, the step is wrong.
- **Build an edition system.** § 4.
