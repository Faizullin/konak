# UI refactor notes

Analysis behind the MVP report, the interface work, and the proposed edition
system. Written 2026-09-13 from a read of the code, the committed screenshots,
`docs/kontur-notes/`, and the web.

These are **notes, not guides.** `docs/guides/` describes how things are and is
binding; nothing here is. Where a note disagrees with the code, the note is out
of date — check the code.

| File | Read it for |
|---|---|
| [mvp-analysis.md](mvp-analysis.md) | the client's eight MVP items mapped to what exists, the two questions that need answering before sign-off, and what `docs/kontur-notes/` is worth |
| [ui-analysis.md](ui-analysis.md) | what is wrong with the interface today, and how Kontur, Bnovo, TravelLine, Mews and Cloudbeds build theirs |
| [edition-system-plan.md](edition-system-plan.md) | the env-selected UI/feature preset — design, constraints, and a five-step rollout |
| [handoff-prompt.md](handoff-prompt.md) | all of the above condensed into one pasteable prompt, with the order of work |

## The short version

Three bugs to fix first, none of them a Phase 12 concern:

1. **`max-w-5xl` on every dashboard route** (`app/(app)/dashboard/layout.tsx`)
   caps the reservation grid at 976px, so the default 31-night window shows 20
   nights on any monitor.
2. **The sidebar is never translated** — `ORG_MODULE_REGISTRY` and
   `config/nav-items.ts` carry English literals, so the Russian locale leaves
   the whole nav in English.
3. **Grid colours are literal Tailwind, not tokens**, so they will not move
   with a theme — and sold-out nights are painted with `text-destructive`.

Then a decision: whether a second edition is actually wanted, or whether the
real goal was "make the front desk wide and dense" — which fixing (1) already
delivers.

## Still outstanding

The client-facing MVP report itself. Language undecided: Russian for the
client, or English for internal use.
