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
export function MyForm() {
  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  const mutation = trpc.organization.create.useMutation({
    onSuccess: () => toast.success("Organization created"),
    onError: (e) => handleFormError(form, e),
  });

  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
      <FormError message={form.formState.errors.root?.message} />
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
      <Button type="submit" disabled={mutation.isPending}>Save</Button>
    </form>
  );
}
```


`FieldError` takes either `errors={[fieldState.error]}` (it de-duplicates and
renders a list when there is more than one) or plain children for a single
message.

`organization-form-nice-dialog.tsx` is the full worked example, including re-seeding the
form on open so a cancelled edit never leaks into the next one.

**Deriving a form schema from a router schema.** When the router's schema
carries fields a form should not — an id the component holds as a prop, or a
`.default()` — derive rather than write a second schema:

```ts
export const addMemberFormSchema = addMemberSchema
  .omit({ organizationId: true })
  .extend({ role: assignableOrgRoleSchema });
```

The `.extend()` is not decoration: `addMemberSchema.role` has a `.default()`,
and the rule above says a schema default and `defaultValues` must not both
exist. Stripping it there leaves the schema owning the rules and the form
owning the default. Keep the derived schema in `model/` beside its parent, not
in the component.

---

## Errors

Where an error appears is decided once, in `lib/errors.ts`, not in each
`onError`. `normalizeError` collapses the two dialects that reach the browser —
tRPC **throws** `{ message, data: { code, httpStatus, zodError, field } }`,
Better Auth **returns** `{ data, error }` with `{ message, status, code }` — into
one `AppError`, and the kind decides the destination:

| Kind | Comes from | Renders as |
|---|---|---|
| `field` | Zod's `fieldErrors`, or `fieldError()` naming one field | under that field |
| `form` | `BAD_REQUEST`, `CONFLICT`, Zod's `formErrors` | `<FormError />` on the form |
| `auth` | `UNAUTHORIZED` / 401 | redirect to `/sign-in`, handled globally |
| `forbidden` | `FORBIDDEN` / 403 | toast — editing the form cannot fix it |
| `notFound` | `NOT_FOUND` / 404 | toast |
| `server` | anything else, including 500 | toast, **generic copy** |
| `network` | the request never left | toast |

A 500's message is dropped rather than shown — it quotes a stack trace or a
connection string at someone who cannot act on it. `errors.test.ts` pins that.

**In a component**, that is two shapes:

```ts
// a mutation with a form behind it
onError: (e) => handleFormError(form, e),

// a mutation without one
onError: (e) => handleError(e),
```

`handleFormError` always places field errors; a server field with no
counterpart on the form falls through to the form-level error rather than
vanishing. Render that, or the branch is invisible:

```tsx
<FormError message={form.formState.errors.root?.message} />
```

Options: `fallback: "form" | "toast"` moves the non-field message,
`fallbackMessage` fills in only when the error carried none of its own, `map`
routes a server field name onto a different form field, `toast: false` hands
the `AppError` back unrendered. The sign-in form passes `fallback: "form"` — a
wrong password is a 401, and redirecting to `/sign-in` from `/sign-in` is absurd.

**Naming a field is a server-side act.** Zod fills `zodError.fieldErrors`; for
rules needing the database, `fieldError("slug", "That slug is already taken",
"CONFLICT")` in `server/errors.ts` puts the message under the slug input.

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

The URL *is* the state, so a link to "orgs I own, sorted by newest" reopens
exactly that and a refresh does not reset the view. Needs `<NuqsAdapter>` in
the root layout — already there.

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

A second *reader* of one source of truth, not a second source of truth. A
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

### 2. `NiceModal.create` — a dialog with its own form, opened from anywhere

For a dialog rich enough to have fields and mutations, and reachable from more
than one component:

```tsx
export const OrganizationFormNiceDialog = NiceModal.create(({ mode, organizationId }) => {
  const modal = useModal();
  return (
    <FormDialog
      open={modal.visible}
      onOpenChange={(open) => !open && modal.hide()}
      title="New organization"
      onSubmit={form.handleSubmit(onSubmit)}
      error={form.formState.errors.root?.message}
      isLoading={mutation.isPending}
      submitText="Create organization"
    >
      …fields…
    </FormDialog>
  );
});

// from anywhere:
NiceModal.show(OrganizationFormNiceDialog, { mode: "edit", organizationId });
```

### 3. `useDialogControl` — state a component owns outright

Same `FormDialog` as above — only the owner of `open` changes:

```tsx
const control = useDialogControl<Member>();

<Button onClick={() => control.show(member)}>Edit</Button>
<FormDialog open={control.isVisible} onOpenChange={(open) => !open && control.hide()} …>
```

Never a raw `Dialog` with a `useState(false)` beside it: that is this hook,
written out longhand and without the `data` slot.

`people-table-view.tsx` is the worked example: it owns the "new person" dialog,
nobody else opens it, and the state lives beside the button that raises it.

### `BaseDialog` and `FormDialog`

Both tiers above render through the same two components in
`components/common/`, so the dialog chrome is written once:

- **`BaseDialog`** — overlay, content, titled header, optional footer. Holds no
  state; `open` / `onOpenChange` come from whoever owns the dialog.
- **`FormDialog`** — `BaseDialog` plus the `<form>`, the `<FormError />`, and a
  Cancel/Submit footer whose submit button spins and disables on `isLoading`.

Pass `form.formState.errors.root?.message` as `error`. `handleFormError` puts
anything it could not place under a field there, and a dialog that does not
render it fails silently — see [Errors](#errors).

---

## Comboboxes

`ComboBox` takes a `searchFn(query, offset, size)` rather than an options
array, because the lists worth a combobox are the ones too long to hold in a
`<Select>`. Typing debounces into it; "Load more" pages with the same call.
`valueKey` names the field that identifies an option — selection, the tick mark
and the load-more cursor all compare on it.

```tsx
<ComboBox
  title="Select organization"
  valueKey="id"
  value={field.value}
  onChange={field.onChange}
  renderText={(org) => org.name}
  searchFn={(search, offset, size) => utils.organization.search.fetch({ search, offset, size })}
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

`toast` from **sonner** — `toast.success`, `toast.error`, `toast.loading` with
an id to update in place. `<Toaster />` is mounted in
`components/layout/providers.tsx`.

Toast successes and things a person did. For failures use `handleError` /
`handleFormError`, never `toast.error(e.message)` — see [Errors](#errors).

---

## The sidebar

The nav is **data**, in `src/config/nav-items.ts`. One renderer (`NavMain`)
draws every level, and gating an item on a role is a field (`roles`) rather
than a conditional buried in markup.

Which level shows is derived from the **route**, never from state, so a deep
link renders the right sidebar on first paint:

```
/dashboard/*                accountNavItems
/dashboard/orgs/[orgSlug]/*  organizationNavItems(orgSlug)
```

Adding a level is the same move: read another route param in `app-sidebar.tsx`
and return another `NavGroup[]`. The frame knows how to *pick* a level; it does
not know what any feature needs.

---

## Colour as data

Where colour encodes a value rather than decorating one — reservation state on
the grid, room status, anything Phase 12 will restyle — **colour is never the
only cue.** Every pair of values has to differ by something else as well:
a glyph, a border style, a fill.

`reservation-grid.tsx` is the worked example. `STATUS_CLASS` carries the hue and
`STATUS_MARK` carries a shape — hollow for a room still waiting, filled for a
guest in it, a tick for a stay that is over — and enquiry and checked-out also
differ by border style. Check the pairs, not the list: four states that all look
distinct in a legend can still have two that differ by hue alone.

The mark is `aria-hidden`. The chip's `title` already carries the status in
words, so this is for the eye that cannot use the hue, not for the screen
reader — a second announcement of the same fact is noise.

**Both themes, always.** A palette written as fixed light values disappears at
night, and front desks run dim. Pair every `bg-*`/`text-*` with its `dark:`
variant; the project's dark mode is class-based (`@custom-variant dark` in
`styles/globals.css`), so it is a variant, not a media query.

**A legend where the marks are used.** A second cue nobody can decode is not a
second cue.

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
