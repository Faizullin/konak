# Todo

The next few things, in order. A title and one line of why — no status, no
boxes. A finished item leaves here; the fact of it goes to `history.md`.

Where this sits in the whole build: `plans/roadmap.md`.

## Directory screens
`DIRECTORY` is registered as a module and off by default because it has no
route. Its router exists and is tested. This is what turns the first non-core
module from declared into usable.

## Reservation and availability procedures
`reservations`, `rates` and `platform` have tested `model/` layers and no
`server/`. Availability, quoting, create/move/cancel — the invariants exist and
nothing calls them.

## The reservation grid
Rooms down, dates across. Not the DataTable stack; a virtualised two-axis
timeline. The largest piece of UI in the product, and the phase after this one
depends on it.

## A worker draining OutboxTask
The table is the intent; nothing acts on it. Needed before anything talks to an
external system.

## Field-level encryption
`IdentityDocument.numberEncrypted` is named for an obligation the code does not
meet. Until it does, that column holds plaintext.
