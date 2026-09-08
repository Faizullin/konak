# Todo

What is next, in order. Titles and a line of why — no status, no boxes. A
finished item leaves here and appears in `history.md`.

## Routers for the PMS domains
`platform`, `reservations` and `rates` have tested `model/` layers and no
`server/`. The invariants exist; nothing calls them yet.

## Reservation grid
Rooms down, dates across, drag to move. Not the DataTable stack — a virtualised
two-axis timeline with its own range-query shape, and the largest single piece
of UI in the product.

## Field-level encryption
`IdentityDocument.numberEncrypted` is named for an obligation the code does not
yet meet. Until it does, that column holds plaintext.

## A worker draining OutboxTask
Nothing calls an external system inline. The table is the intent; there is no
process that acts on it.

## JSON columns
Postgres has a real `Json` type now. `customFields`, `options` and `diffJson`
are `String` because SQLite had none, and the parsers in `model/` work either
way — but a queryable column would earn its migration.

## Channel manager integration
One wholesale API, one certification, 60+ OTAs. `ChannelConnection`,
`ChannelMapping` and `ChannelSyncState` are waiting for it.
