# Todo

The next few things, in order. A title and one line of why — no status, no
boxes. A finished item leaves here; the fact of it goes to `history.md`.

Where this sits in the whole build: `plans/roadmap.md`.

## Internationalisation
The extraction is finished — refusals, Zod messages, page shells, every
feature's components and the label tables. `npm test` fails on a message nothing
reads and on a key nothing declares, in both directions.

One thing remains: **a second locale**, which is the first point any of it is
visible. Every string in the app now comes from `messages/en/`, including the
refusals the `model/` rules used to word themselves.

## Visual design and motion
Last, once the product works. Density, colour-as-data, keyboard rules, and
animation only where it explains something. Until then shadcn's defaults, which
are good enough to run a hotel and cheap to replace.
