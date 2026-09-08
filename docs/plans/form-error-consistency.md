# One form validates in the browser, the other does not

`organization-form-nice-dialog.tsx` validates with `zodResolver` and renders failures
inline under the field. The add-member form in `member-table.tsx` validates
nowhere, so a typo'd email travels to the server and comes back as a toast.
Same product, two different answers to "you typed something wrong".

## The evidence

- `features/organizations/model/organization.ts:132` defines `addMemberSchema`,
  including a written email message. **The UI never imports it.** The schema is
  enforced only by the router, which is the one place the person cannot see.
- `features/organizations/client/components/member-table.tsx:101-138` is a
  hand-rolled `<form>`: a `useState` pair for email and role, `required` on the
  input, and `disabled={... || !email}` on the button. No resolver.
- `server/trpc.ts:20` has an `errorFormatter` that publishes
  `zodError.fieldErrors` so a client can map failures back onto fields.
  **Nothing reads it.** The only mention of `zodError` outside that file is a
  comment at `features/organizations/model/organization.ts:13`.
- All nine client handlers are `onError: (e) => toast.error(e.message)`.

So the server does the work to describe *which field* failed, and every client
throws that structure away and toasts a string.

## What to do

Convert the add-member form to the pattern already used by
`organization-form-nice-dialog.tsx` — `useForm` + `zodResolver`, `Controller`, and
`<Field data-invalid>` / `<FieldError>` from `@/components/ui/field`, as
described in `../guides/ui-patterns.md`.

Bind it to `addMemberSchema.omit({ organizationId: true })` and merge the
`organizationId` prop at submit. Deriving the form schema from the router's
schema keeps one source of truth; writing a second schema for the form is the
thing to avoid. Drop the `useState` pair and the `!email` check — the resolver
subsumes both.

While in the file: `member-table.tsx:118` passes `items={ORG_ROLE_LABELS}` to
`<Select>`. `components/ui/select.tsx` has no such prop, and the sibling
`<Select>` at line 170 does not pass it. It is inert. Remove it.

Then decide the larger question, which this plan does not settle: either wire
`zodError.fieldErrors` into a shared `onError` that calls `form.setError`, or
delete the `errorFormatter` branch. Publishing a channel nobody reads is the
worst of the three options, because it reads as though field errors work.

## Done when

- The add-member form shows a bad email inline, with no network request.
- `addMemberSchema` has an importer outside `server/`.
- No inert props remain on `member-table.tsx`.
- `zodError.fieldErrors` is either consumed or gone.
