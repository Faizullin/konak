# UI patterns

How forms, lists, dialogs and comboboxes are built here. These are conventions,
not rules the compiler enforces — follow them so screens stay consistent and so
a reader can predict where the state lives.

## Forms

`react-hook-form` + `zod` + the **`@/components/ui/field`** primitives. More
flexible than shadcn's `Form` wrapper, and it keeps the schema visible at the
top of the file.

**Do:**

- Use `useForm` with `zodResolver`, and take the schema from the feature's
  `model/` — the same object the router validates against.
- **Zod defaults:** if you pass `defaultValues` to `useForm`, do **not** also
  use `.default()` in the schema. The schema default overrides the form default
  and the conflict is invisible until a field resets to the wrong value.
- Compose `Field`, `FieldLabel`, `Input`, `FieldError` directly, each wrapped in
  a `Controller`.
- **Loading:** `disabled={mutation.isPending}` on the submit button. Do not
  return early with a spinner — that unmounts the form and loses what was typed.

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createOrganizationSchema, type CreateOrganizationInput } from "@/features/organizations";
import { trpc } from "@/utils/trpc";

export function MyForm() {
  const utils = trpc.useUtils();

  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  const mutation = trpc.organization.create.useMutation({
    onSuccess: async () => {
      toast.success("Organization created");
      await utils.organization.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
      <FieldGroup>
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field data-invalid={!!fieldState.error}>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input id="name" {...field} disabled={mutation.isPending} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
```

`FieldError` takes either `errors={[fieldState.error]}` (it de-duplicates and
renders a list when there is more than one) or plain children for a single
message.

`organization-form-nice-dialog.tsx` is the full worked example, including re-seeding the
form on open so a cancelled edit never leaks into the next one.

---

## Lists and tables

Anything sortable, filterable or paginated uses the `DataTable` stack in
`@/components/data-table`. A short read-only list — a handful of rows, no
column header worth clicking — is fine as plain `@/components/ui/table`
markup; `member-table.tsx` is that case.

### The stack is server-driven

`useDataTable` is **manual mode**: `manualPagination`, `manualSorting` and
`manualFiltering` are all on. It does not slice an array in the browser. It
keeps page, sort and every filter in the **URL** via `nuqs`, and your procedure
does the work.

That is the property worth having: the URL *is* the state, so a link to "orgs
I own, sorted by newest" reopens exactly that, and a refresh does not reset the
view.

It requires `<NuqsAdapter>` in the root layout — already there.

### Wiring one up

Three pieces, in this order:

1. **A procedure** taking `{ filter, orderBy, pagination }` and returning
   `{ items, total, meta }`. `organization.list` is the reference, and
   `listOrganizationsSchema` in `model/` is the contract between it and the
   table.
2. **Columns**, where a `meta` block is what makes a column filterable — the
   toolbar reads `meta.variant` and renders the control. Nothing registers a
   filter component by hand.
3. **`useDataTable`**, given `pageCount` derived from the server's `total`.

```tsx
{
  id: "name",
  accessorKey: "name",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Organization" />,
  cell: ({ row }) => <span>{row.original.name}</span>,
  enableSorting: true,
  enableColumnFilter: true,
  meta: { label: "Organization", placeholder: "Search names…", variant: "text" },
}
```

| `meta.variant` | Toolbar control | Also needs |
|---|---|---|
| `text` | a debounced input | `placeholder` |
| `select` / `multiSelect` | a faceted popover | `options: Option[]` |
| `date` / `dateRange` | a calendar popover | |
| `range` | a two-handle slider | `range`, `unit` |

```tsx
const { table } = useDataTable({
  data: data?.items ?? [],
  columns,
  pageCount: data ? Math.max(1, Math.ceil(data.total / perPage)) : 1,
  getRowId: (row) => String(row.id),
  initialState: { sorting: [{ id: "name", desc: false }] },
});

if (isLoading && !data) return <DataTableSkeleton columnCount={6} rowCount={5} filterCount={3} />;

return (
  <DataTable table={table}>
    <DataTableToolbar table={table} />
  </DataTable>
);
```

Use `placeholderData: (prev) => prev` on the query. Without it the table
collapses to a skeleton on every page change; with it the previous page stays
on screen until the next arrives.

`DataTableSkeleton` for loading — never `return <div>Loading…</div>`, which
makes the layout jump.

### Reading the URL state back

The query has to run *before* the table is built, because the row count decides
`pageCount` — so the component parses the same search params `useDataTable`
writes. `useOrganizationTableParams` in `organizations-table-view.tsx` is that
function, and the encodings it decodes are:

| Key | Encoding |
|---|---|
| `page`, `perPage` | plain integers, `page` is **one-based** |
| `sort` | `JSON.stringify([{ id, desc }])` |
| a `text` filter | the raw string, under the column id |
| a `multiSelect` filter | comma-separated values, under the column id |

It is a second reader of one source of truth, not a second source of truth. A
hand-edited `?sort=` falls back to the default ordering rather than throwing.

### Empty states

"Nothing matched your filter" and "you have nothing yet" are different
messages, and the second is the one people misread as breakage. `DataTable`
renders "No results." for the first. The second needs its own check —
`organization-list.tsx` asks `organization.listMine` whether the person has any
organizations *at all* before deciding which to show.

---

## Dialogs

Three tools, in order of how much state you want to own.

**Naming.** A component built with `NiceModal.create` ends in `NiceDialog`, and
its file is that name in kebab-case — `ConfirmNiceDialog` in
`confirm-nice-dialog.tsx`. The suffix is load-bearing rather than decorative: a
`NiceDialog` is mounted once under the provider and opened by `NiceModal.show`
from anywhere, so it is never imported and rendered as JSX the way an ordinary
dialog is. Reading the suffix tells you which of the three tools below you are
looking at.

Say what the dialog *does* before the suffix. `OrganizationFormNiceDialog`
carries a form, so `Form` is in the name; a plain question would be
`SomethingConfirmNiceDialog`. The `confirm()` and `selectOne()` wrappers keep
their verb names — they are the API, and the component behind each is an
implementation detail.

**Which tier.** Choose by *ownership*, not by how many call sites exist today.
`confirm()` and `selectOne()` are generic — any feature can ask a yes/no
question or pick one of many — so they are `NiceDialog`s even while only one
caller exists. A single call site there is a fact about the app's age, not
about who owns the dialog. `useDialogControl` is for the opposite case: a
dialog whose content belongs to one component and that nobody else would ever
open.

### 1. `confirm()` and `selectOne()` — no state at all

Global, promise-based, mounted once under `NiceModal.Provider`. Use these for
anything destructive or for "pick one of many". An event handler reads top to
bottom:

```ts
import { confirm } from "@/components/common/confirm-nice-dialog";
import { selectOne } from "@/components/common/select-nice-dialog";

if (!(await confirm({ title: "Remove Alice?", destructive: true }))) return;
removeMember.mutate({ organizationId, userId });

const picked = await selectOne({ title: "Transfer to", valueKey: "id", renderText, searchFn });
if (!picked) return;
```

`confirm()` resolves when the person answers — `true` for confirm, `false` for
cancel or dismiss — and the dialog closes either way. The mutation runs after,
reporting through its own `onSuccess` / `onError` like every other mutation
here. Confirming is a question, so it is awaited; the outcome is not.

`organization-danger-zone.tsx` uses both shapes: a plain confirm, and a
`selectOne()` followed by a confirm.

### 2. `NiceModal.create` — a dialog with its own form

For a dialog rich enough to have fields and mutations, and openable from
anywhere:

```tsx
export const OrganizationFormNiceDialog = NiceModal.create(({ mode, organizationId }) => {
  const modal = useModal();
  return <Dialog open={modal.visible} onOpenChange={(open) => !open && modal.hide()}>…</Dialog>;
});

// from anywhere:
NiceModal.show(OrganizationFormNiceDialog, { mode: "edit", organizationId });
```

### 3. `useDialogControl` — state a component owns outright

When one component opens one dialog and nobody else needs to:

```tsx
const dialog = useDialogControl<Member>();

<Button onClick={() => dialog.show(member)}>Edit</Button>
<Dialog open={dialog.isVisible} onOpenChange={dialog.hide}>
  <DialogContent>{dialog.data && <MemberForm member={dialog.data} />}</DialogContent>
</Dialog>
```

### Dialog composition

A dialog a parent opens takes `open` / `onOpenChange` props and owns none of
that state itself; the **parent** holds it with `useDialogControl`. That split
keeps the dialog reusable and stops two components disagreeing about whether it
is open.

---

## Comboboxes

`ComboBox` takes a `searchFn(query, offset, size)` rather than an options
array, because the lists worth a combobox are the ones too long to hold in a
`<Select>`. Typing debounces into it; "Load more" pages with the same call.
`valueKey` names the field that identifies an option — selection, the tick mark
and the load-more cursor all compare on it.

```tsx
import { ComboBox } from "@/components/common/combobox";

<Controller
  control={form.control}
  name="organization"
  render={({ field, fieldState }) => (
    <Field data-invalid={!!fieldState.error}>
      <FieldLabel>Organization</FieldLabel>
      <ComboBox
        title="Select organization"
        valueKey="id"
        value={field.value}
        onChange={field.onChange}
        renderText={(org) => org.name}
        searchFn={(search, offset, size) =>
          utils.organization.search.fetch({ search, offset, size })
        }
      />
      <FieldError errors={[fieldState.error]} />
    </Field>
  )}
/>
```

`organization.search` is a procedure written to exactly that contract
(`{ search, offset, size }` in, a flat array out). Copy its shape for any other
paginated picker. It only fetches while the popover is open, so a form with six
comboboxes does not fire six queries on mount.

For a plain fixed list — two or three roles, a status — use
`@/components/ui/select` instead. A combobox with four options is a search box
with nothing to search.

---

## Toasts

`toast` from **sonner** — `toast.success`, `toast.error`, and `toast.loading`
with an id to update in place. The `<Toaster />` is mounted in
`components/layout/providers.tsx`.

Every mutation gets an `onError: (e) => toast.error(e.message)`. The router's
messages are written to be read by a person, which is the point of putting them
there rather than throwing bare codes.

---

## The sidebar

The nav is **data**, in `src/config/nav-items.ts`. One renderer (`NavMain`)
draws every level, and gating an item on a role is a field (`roles`) rather
than a conditional buried in markup.

Which level shows is derived from the **route**, never from state, so a deep
link renders the right sidebar on first paint:

```
/dashboard/*                accountNavItems
/dashboard/orgs/[orgId]/*   organizationNavItems(orgId)
```

Adding a level is the same move: read another route param in `app-sidebar.tsx`
and return another `NavGroup[]`. The frame knows how to *pick* a level; it does
not know what any feature needs.

---

## General guidelines

- **tRPC** for all API calls. `trpc.useUtils()` for invalidation.
- **Absolute imports**, `@/...`.
- **Skeletons** over full-page spinners.
- **`staleTime`** on anything the shell renders on every page (the switcher,
  the current user) — refetching those on each navigation is pure noise.
- **Invalidate what changed**, not everything. A mutation that adds a member
  invalidates `listMembers`, `getById` and `list`, because all three show a
  count that just moved.
