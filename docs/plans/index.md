# Plans

What is **not built yet**. Guides describe how things are; plans describe what
is planned. A plan carries no status and no checkboxes — when something ships it
leaves here, what it taught moves into a guide, and the fact of it goes into
`../history.md`.

| Plan | What it is |
|---|---|
| [roadmap.md](roadmap.md) | the order to build the product in, phase by phase — **start here** |
| [hotel-pms.md](hotel-pms.md) | what the product is: domain, modules, decisions |
| [inventory-units.md](inventory-units.md) | what a bookable unit is — a bed in a dorm, and a баня by the hour |
| [product-shape.md](product-shape.md) | the same ground from the client's side — what a PMS must do, in their words |
| [internationalisation.md](internationalisation.md) | the translation choice, and what Next 16 changed about it |
| [external-api.md](external-api.md) | letting other software call this one, with scoped keys |
| [file-uploads.md](file-uploads.md) | where the bytes go, and why the attachment table is empty |
| [server-hardening.md](server-hardening.md) | what a full audit of the routers found: a missing write path, five races, and the guard chain |
| [second-surface.md](second-surface.md) | a `desk2` with its own CSS base, its own components and its own way in — and what that actually costs |
| [desk-generation.md](desk-generation.md) | the machinery that makes a second desk a registry entry instead of a copied layout — and the sidebar the one desk is missing |
| [notifications.md](notifications.md) | an in-app feed and the bell the header already has a hole for |
| [dashboard-header.md](dashboard-header.md) | what is left of the dashboard's header: the language switch, and an inbox |

Files prefixed `v1_` are **not plans**. They are earlier ones recovered from
git history, kept only because something in them had not shipped; each says at
the top what survives and what was superseded. Do not work from them.

Each plan states the evidence it rests on as `file:line`. Check the citation
before acting on it — a plan written against a moved line is worse than no plan.
