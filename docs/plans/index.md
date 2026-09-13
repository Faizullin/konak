# Plans

What is **not built yet**. Guides describe how things are; plans describe what
is planned. A plan carries no status and no checkboxes — when something ships it
leaves here, what it taught moves into a guide, and the fact of it goes into
`../history.md`.

| Plan | What it is |
|---|---|
| [roadmap.md](roadmap.md) | the order to build the product in, phase by phase — **start here** |
| [mvp-roadmap.md](mvp-roadmap.md) | the short one beside it: design, layout and the demonstration. Adds no feature |
| [hotel-pms.md](hotel-pms.md) | what the product is: domain, modules, decisions |
| [internationalisation.md](internationalisation.md) | the translation choice, and what Next 16 changed about it |
| [external-api.md](external-api.md) | letting other software call this one, with scoped keys |
| [file-uploads.md](file-uploads.md) | where the bytes go, and why the attachment table is empty |
| [file-uploads-ui.md](file-uploads-ui.md) | the browser half of it: the components, and where each one lives |
| [e2e-and-reports.md](e2e-and-reports.md) | a browser driving the real app, and the screenshot report that falls out of it |
| [dashboard-header.md](dashboard-header.md) | the dashboard's empty header, and the seam under it: a surface wears a theme — `basic`, `desk`, and what a `desk2` on another CSS base would cost |

Files prefixed `v1_` are **not plans**. They are earlier ones recovered from
git history, kept only because something in them had not shipped; each says at
the top what survives and what was superseded. Do not work from them.

Each plan states the evidence it rests on as `file:line`. Check the citation
before acting on it — a plan written against a moved line is worse than no plan.
