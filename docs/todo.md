# Todo

The next few things, in order. A title and one line of why — no status, no
boxes. A finished item leaves here; the fact of it goes to `history.md`.

Where this sits in the whole build: `plans/roadmap.md`.

## Design direction
The next phase, and it comes before the grid on purpose. Density, keyboard,
colour-as-data and dark mode decided once — otherwise they get decided by
accident inside the largest piece of UI in the product.

## The reservation grid
Rooms down, dates across. Its procedures exist now: availability, create,
setStatus, assignRoom, quote.

## Room and rate-plan management
Room types, rooms and plans are seeded and readable but have no screens, so a
property can only be set up through SQL.

## A worker draining OutboxTask
The table is the intent; nothing acts on it. Needed before anything talks to an
external system.

## Field-level encryption
`IdentityDocument.numberEncrypted` is named for an obligation the code does not
meet. Until it does, that column holds plaintext.
