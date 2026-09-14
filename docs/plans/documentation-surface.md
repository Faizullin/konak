# A documentation surface — `/docs`

A place inside the product that explains the product: a handbook a front-desk
clerk can be sent a link to, and later the reference an integrator reads before
calling the external API.

Nothing here is built. `docs/` is this repository's own documentation — English,
developer-facing, and not in the production image at all. This plan is about the
other thing: pages the app itself serves.

Read [ui-patterns.md](../guides/ui-patterns.md) § Surfaces and themes and
§ Strings first; both are binding and this plan sits inside them rather than
beside them.

---

## Two readers, and only one of them exists yet

| Reader | Wants | Exists today |
|---|---|---|
| A hotel's staff | how the шахматка works, what «Не выбран номер» means, why a bill will not close | the words exist, in [mvp-report.ru.md](../reports/mvp-report.ru.md) — nowhere a clerk can reach |
| An integrator | endpoints, keys, scopes, error codes | **no** — `external-api.md:6` says "Nothing here is built" |

So the handbook is first, and it is first for a reason rather than by
preference: documenting an API that does not exist is how a docs page starts
lying on the day it ships. The same shell serves the second reader unchanged
when the API lands — § The developer half, below.

**The handbook's source language is Russian.** Every other document in this
repository is English-first, and this one inverts deliberately: its reader is a
clerk in Kazakhstan, and the client's report is already written for them.

---

## What the sibling project does, measured

ArqaMed has this page, and it is worth being precise about what it actually is,
because it is much smaller than its reputation:

- **`src/app/docs/page.tsx`, 421 lines, plus a 57-line `CodeBlock.tsx`.** That
  is the whole implementation.
- **No dependency was added.** No MDX, no remark, no Shiki, no docs framework.
- A local `NAV` array of twelve ids drives an anchor sidebar; `<Section>`,
  `<Endpoint>` and `<MethodBadge>` are local components in the same file.
- English only. No search. Public, with no middleware gating it.
- One thing, and only one, is not retyped prose: `ALL_SCOPES` is imported from
  `lib/api-keys/scopes` and printed. Everything else is hand-copied from the
  code it describes.
- The contract is not the page. `GET /api/v1/openapi.json` is served publicly
  and has its own spec test; the page is the narrative around it.

**What to take:** zero dependencies is a real result; a machine-readable twin is
the right answer for the API half; and anything enumerable should be imported,
never retyped.

**What not to take:** 421 lines of prose inside JSX cannot be translated, and
konak ships two languages. That single fact decides the implementation below.

---

## The implementation, and the three that were rejected

| Approach | Why not |
|---|---|
| Hand-written TSX, ArqaMed's way | Paragraphs of Russian inside JSX, or inside `messages/*.json`. Both are the wrong home for prose — § Where the words live |
| Fumadocs | The best Next 16 / Tailwind 4 docs framework there is, and it brings its own layout, its own theme system and its own search index. `config/surfaces.ts`, `styles/surfaces/` and the contrast palette already answer those questions, and two answers is worse than one. Also the heaviest option on one core |
| Nextra | Tighter layout coupling than Fumadocs, for less |
| Docusaurus, VitePress, Starlight | A second site, a second deploy, a second thing to keep alive. In-product help is not a static site |
| **Reading `docs/*.md` at runtime** | **Impossible in production as built**, and not for a subtle reason — see below |

`Dockerfile:92`, `:96` and `:97` copy exactly three things into the runner:
`.next/standalone`, `.next/static` and `public/`. `docs/` is not among them and
should not be; the runner stage holds no source on purpose. A page calling
`fs.readFile("docs/…")` works in `next dev` and 500s in the image — the worst
shape a bug can have.

So: **content compiled at build time**, never read from disk at runtime.
`@next/mdx` with `@mdx-js/loader` and `@mdx-js/react`, composed around the
existing `createNextIntlPlugin` wrapper at `next.config.ts:12`. Three
dependencies, and the traced output carries the compiled pages.

MDX is **imported content, not routing**. `pageExtensions` stays as it is: one
`[[...slug]]` route reads a registry, and the registry stays the only thing that
knows what pages exist and in what order.

---

## Where the files go

```
content/docs/{ru,en}/*.mdx    prose. Beside `messages/`, not under `src/`,
                              for the reason `architecture.md` gives about
                              `scripts/`: it is content, not the module graph
src/config/docs.ts            the registry — data, not behaviour
src/config/docs.test.ts       because nav-items.ts and surfaces.ts have one
src/features/docs/client/     DocsShell, DocsNav, DocsToc, mdx-components
src/app/(public)/docs/[[...slug]]/page.tsx
src/styles/surfaces/docs.css  prose tokens, if the shell needs any of its own
```

Three consequences of putting it there, all of them arguments in favour:

**`features/docs` is a surface, and takes the shape `desk` already proved.**
`architecture.md:65` — no `server/`, no `model/`, no barrel. It adds no
capability and calls no procedure; it is a shell and a set of screens. A
`server/` here would be the first sign the plan has drifted.

**`(public)` stops being a group that asserts nothing.** `architecture.md:202`
says there is no `(public)` group because there is one public page today and
"an empty group asserts a grouping that does not exist". `/docs` is the second
public route, and it shares a real gate — no session — and a real shell. Moving
`app/page.tsx` in beside it is part of this work, not a tidy-up.

**`docs` must be added to `FEATURES` in `eslint.config.mjs:13`.** The import
zones are written out per feature because a glob that matches nothing reports
nothing. A feature missing from that list is unguarded, silently.

---

## Where the words live

`ui-patterns.md:567` is unambiguous: every user-visible string comes from
`messages/<locale>/<namespace>.json`. This plan does not break that rule, it
draws the boundary the rule was written for.

- **UI chrome** — the sidebar heading, "On this page", "Next", the search
  placeholder — is a `docs` namespace in `messages/`, like everything else.
- **The prose itself** is MDX, one file per page per locale. A paragraph in
  JSON is a paragraph nobody can review: no line diffs, escaping instead of
  punctuation, and a translator working inside a data structure.

The registry holds the title *key*, not the title. The words stay in one of the
two places above, never in `config/`.

---

## The locale problem, which is real and already documented

`lib/i18n.ts:10` — **there is no locale in the URL.** The language comes from a
cookie, and `internationalisation.md` says why. A link to `/docs/grid` therefore
opens in the reader's own language, not the sender's.

For a handbook that is arguably the correct behaviour — a clerk who reads
Russian should get Russian from a link a colleague sent in English. The plan
keeps the cookie, because a surface that resolves its language differently from
the rest of the app is a second rule to hold in mind for one page's benefit.

What it does cost is stated at `lib/i18n.ts:15`: a route reading the cookie is
dynamic. That note ends "It is the thing to re-examine when Phase 8 wants a
prerendered public booking page" — and a public, cacheable, crawlable docs page
is the **same pressure arriving earlier**. This plan does not solve it; it is
the first place the question is worth asking, and whoever builds the booking
page should find this paragraph.

---

## The registry, and why it is tested

`src/config/docs.ts`, in the shape `nav-items.ts` and `locales.ts` already use —
isomorphic, dependency-free, data: ordered groups of
`{ id, slug, titleKey, icon, audience }`. The sidebar, the breadcrumb, the
"next page" link and eventually the search index all read it rather than each
keeping its own list.

`src/config/docs.test.ts` asserts that slugs are unique and that **every entry
resolves to a file in every locale**. That is the one test that stops a
half-translated page shipping as a blank screen, it needs no database, and it
belongs in `npm test` — which `guides/index.md` requires to stay runnable on a
laptop with no Docker, in under a second. Both siblings in `config/` already
carry a test; this is not a new precedent.

---

## Rendering

`mdx-components` maps `h1…h4`, `p`, `ul`, `table`, `code` and `pre` onto what
`components/ui` already has — `Table`, `Badge`, `Separator`, `Card`.

**No `@tailwindcss/typography`.** `prose` hard-codes colours, and
`ui-patterns.md:525` is *No component names a colour*. A docs page that ignores
that is a docs page that is unreadable in the contrast palette the desk ships
for a bright lobby.

**No syntax highlighter.** A staff handbook contains no code, and the few
snippets the API half will want are served by a port of ArqaMed's dependency-free
`CodeBlock` — a dark block and a copy button. Shiki on one vCPU buys colour and
costs build time.

---

## The work, in order

**First, the shell against one page.** The three dependencies, the route, the
registry with a single entry, the MDX component map, and `getting-started.mdx`
in both languages. That page proves the whole pipeline — build-time compilation,
the cookie's locale, the theme, the registry test — and until it does, writing
nine more pages is writing into an unproven container.

**Then the handbook.** This half is writing, not engineering, and
`mvp-report.ru.md` is already its skeleton:

| Page | From |
|---|---|
| `getting-started` | «Где это открывается» — the `/desk/<org>/<property>` address and the six sections |
| `grid` | § 1, § 7, § 8 — the full-length bar, Занято/Свободно, the «Не выбран номер» lane, the diagonal split, the date window |
| `rooms` | § 2, § 4 — and why occupancy and cleanliness are two questions about one room |
| `booking` | § 3 — per-night availability, «Заезд без брони» |
| `reservation` | § 5 — the two tabs are addresses; a refusal always says why |
| `guests` | § 6 — one person with a history, shared across the organisation |
| `housekeeping` | «Что ещё есть сверх задания» — check-out dirties the room by itself |
| `billing` | the same section — the folio opens on check-out, and closes only at zero |
| `not-yet` | «Чего пока нет» — channels are *ready to connect*, which is not *connected* |

The last row is the one that earns the page its trust, and it is the row a
marketing site would drop.

**Screens are named, not photographed.** `docs/screenshots-report/` is already
3 MB of stale light-only PNGs from a tool that no longer exists — `todo.md:59`.
A handbook that embeds PNGs inherits exactly that decay. If pictures are wanted
later, `tests/e2e/report/screens.ts` already produces them in both locales and
both themes, and adding a screen there is one row.

**Search comes last, and adds nothing.** `components/ui/command.tsx` is `cmdk`,
already in the bundle. Wire it over the registry and the page headings when
there are more pages than a sidebar shows at once — not before.

---

## The developer half

Mounted in the same shell at `/docs/api/*`, and **not before
`external-api.md` ships**. Its rule is the one ArqaMed got right and konak can
do better at:

- `GET /api/v1/openapi.json` is the contract and carries a spec test. The page
  is narrative around it.
- Anything enumerable is imported and printed, never retyped: the scopes, and
  the **88 domain error codes** `external-api.md:62` counts. A table of error
  codes typed by hand is wrong within a month.
- The registry's `audience` field is what keeps the two halves in one sidebar
  without a clerk scrolling past `POST /reservations`.

---

## What this plan deliberately does not do

- **It does not gate `/docs` behind a session.** The handbook's value is being
  linkable to someone who is locked out, and that is often exactly who needs it.
- **It does not publish this repository's `docs/`.** Those are internal, in
  English, and cite `file:line`; they are for whoever opens the repo.
- **It does not add a fourth theme, a second CSS base or a marketing page.**
  The docs surface is the app's surface with a narrower column.
- **It does not carry a changelog.** `history.md` is append-only and internal,
  and a user-facing changelog is a commitment to keep writing one.

---

## Where this sits

Ahead of it in real risk, and not displaced by it: there are **no backups of the
production database**, there is no `/api/health` (the container's healthcheck
hits `/`), `FIELD_ENCRYPTION_KEY` has no copy off the server, and the outbox
worker is not deployed, so `outbox_tasks` accumulates unprocessed. `deployment.md`
§ Gaps lists them in order.

A docs surface is safe to build in parallel with any of those. It is not a
reason to delay them.

One small thing rides along, because this work touches the public surface and
would otherwise leave a contradiction on it: `app/page.tsx:16` tells every
visitor the app runs "Prisma on SQLite". It is Postgres. `todo.md:62` has it as
one of three claims in the docs that are not reachable.
