# The data table, without nuqs in the middle

`useDataTable` calls nuqs unconditionally, so **every** table must live under a
`<NuqsAdapter>` and publish its state to the URL. A table in a dialog, a second
table on one route, or a short list that wants neither cannot use the stack at
all — and six components hand-roll `<Table>` markup rather than fight it.

This is a **port, not a design.** `src/components/data-table/use-data-table.ts`
is byte-identical to `next-better-auth-template` before its commit `f298695`,
*"make URL state an option, not a requirement"*, and `lib.ts` is too. The design
question was answered there and shipped; what is left here is applying it to a
tree that has twice as many tables and a second surface.

---

## 1. What is wrong, read rather than remembered

`use-data-table.ts:103-182` — `useQueryState` for `page`, `perPage` and `sort`,
`useQueryStates` for the filters, called straight from the hook body. Hooks
cannot be conditional, so there is no opting out.

Four features then parse **the same params a second time**, because the hook
wrote them and the query needs them:

| | Reads them back at |
|---|---|
| `organizations-table-view.tsx` | `:61` ← `useOrganizationTableParams()` `:245` |
| `users-table-view.tsx` | `:50` ← `useUserTableParams()` `:188` |
| `bookings-table-view.tsx` | `:56` ← `useBookingTableParams()` `:244` |
| `people-table-view.tsx` | `:45` ← `usePeopleTableParams()` `:182` |

Four copies of the same key names and the same hand-rolled `JSON.parse` of
`sort`. They exist because `pageCount` needs the row count, the row count comes
from a query, and the query needs the state the hook is holding — so the state
had to be read from the only place both could see it, the URL.

And six components opted out entirely rather than pay for it:
`member-table.tsx`, `attachment-table.tsx`, `rate-plans-panel.tsx`,
`inventory-panels.tsx`, `booking-card.tsx`, `desk-booking-main.tsx`.

## 2. The shape that fixes it

Two optional injection points, both defaulting to the plain case:

- **`state`** — a storage strategy, typed `DataTableStateHook`. Omitted, page,
  sort and filters live in React state scoped to the component: no URL and no
  adapter, so a dialog works. `nuqsTableState({ prefix })` puts them in the URL,
  and the **prefix** is what lets two URL-backed tables share a route without
  silently sharing `page`, `perPage` and `sort`.
- **`useRows`** — the page's own fetcher. Given one, the table runs manual and
  derives `pageCount` from the `total` it returns; pass `data` instead and the
  browser pages in memory.

`useRows` is the half that deletes the duplication: once the fetcher is called
*from inside* the hook, the state never has to leave it, and all four
`*TableParams` hooks go.

One rule the type exists to enforce: **a table picks a strategy and keeps it.**
Swapping between renders changes the hook order, which React will not survive.

## 3. What this tree adds that the template did not have

- **Two more views.** `bookings` and `people` did not exist upstream; both are
  the same port, and `people` is the one whose filter is a bare text search —
  the case the upstream fix had to correct, because a filter's arity was being
  guessed and `o'brien` split into two terms.
- **A second surface.** `bookings-table-view` renders on `/desk` as well as the
  dashboard. URL state is right there and stays; the prefix matters the day the
  desk puts a second table beside it.
- **Six hand-rolled tables.** Converting them is *not* part of this — it is the
  reason to do it, not the work. Convert one, `member-table.tsx`, as the proof
  the plain case works, and leave the rest to whoever next touches them.

## 4. Not in here

- **A localStorage strategy.** The type admits one; nothing has asked.
- **Advanced filtering.** Upstream dropped `enableAdvancedFilter` because it
  gated a UI neither repo has.
- **Touching `parsers.ts` or `types.ts`.** Both already match the template's
  post-fix copy.

---

## The order to build it in

1. **`table-state.ts`** — `DataTableStateHook`, the React-state default, and
   `nuqsTableState({ prefix })`. Ported.
   **Done when** `npm test` covers the filter round-trip that upstream got
   wrong: a single-arity text filter comes back a string, not a split array.
2. **`use-data-table.ts` takes `state` and `useRows`**, `lib.ts` follows.
   **Done when** the four views render unchanged with the same URLs.
3. **The four `*TableParams` hooks are deleted**, each view passing `useRows`.
   **Done when** `grep -rn "TableParams" src/` is empty and back/forward still
   restores filters — that is the regression, and it is what a URL is for.
4. **`member-table.tsx` becomes a `DataTable`** with no `state` at all.
   **Done when** it renders inside its card with no `<NuqsAdapter>` above it.
5. **`ui-patterns.md` § Lists and tables** gains the choice — URL or not, fetch
   or not — and this file deletes itself.

Then the pass a phase ends with. The thing to measure is the client bundle on
`/dashboard/users`: this moves nuqs from a hard dependency of the hook to a
strategy, and whether that shows up is the question.
