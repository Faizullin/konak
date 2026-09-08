"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormDialog } from "@/components/common/form-dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { personFormSchema, type PersonFormInput } from "@/features/directory";
import { handleFormError } from "@/lib/errors";
import { trpc } from "@/utils/trpc";

/**
 * Add someone to the directory.
 *
 * The parent owns `open`, so this holds no dialog state of its own. Validation
 * is `personFormSchema` from `model/` — the same object the router validates
 * against, so the form cannot accept what the server will refuse.
 */
export function PersonFormDialog({
  organizationId,
  open,
  onOpenChange,
}: {
  organizationId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();

  const form = useForm<PersonFormInput>({
    resolver: zodResolver(personFormSchema),
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", notes: "" },
  });

  // Re-seed on open, so a cancelled entry never leaks into the next one.
  useEffect(() => {
    if (open) form.reset({ firstName: "", lastName: "", email: "", phone: "", notes: "" });
  }, [open, form]);

  const mutation = trpc.directory.createPerson.useMutation({
    onSuccess: async () => {
      toast.success("Person added");
      await utils.directory.listPeople.invalidate();
      onOpenChange(false);
    },
    // A duplicate email arrives from `fieldError("email", …)` and lands under
    // the email box; anything else lands on the form.
    onError: (e) => handleFormError(form, e),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New person"
      description="A guest, a contact, or anyone else this organization deals with."
      onSubmit={form.handleSubmit((values) => mutation.mutate({ organizationId, ...values }))}
      error={form.formState.errors.root?.message}
      isLoading={mutation.isPending}
      submitText="Add person"
    >
      <FieldGroup>
        <Controller
          control={form.control}
          name="firstName"
          render={({ field, fieldState }) => (
            <Field data-invalid={!!fieldState.error}>
              <FieldLabel htmlFor="person-first-name">First name</FieldLabel>
              <Input id="person-first-name" disabled={mutation.isPending} {...field} />
              {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="lastName"
          render={({ field, fieldState }) => (
            <Field data-invalid={!!fieldState.error}>
              <FieldLabel htmlFor="person-last-name">Last name</FieldLabel>
              <Input id="person-last-name" disabled={mutation.isPending} {...field} />
              {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Field data-invalid={!!fieldState.error}>
              <FieldLabel htmlFor="person-email">Email</FieldLabel>
              <Input
                id="person-email"
                type="email"
                placeholder="guest@example.com"
                disabled={mutation.isPending}
                {...field}
                value={field.value ?? ""}
              />
              {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="phone"
          render={({ field, fieldState }) => (
            <Field data-invalid={!!fieldState.error}>
              <FieldLabel htmlFor="person-phone">Phone</FieldLabel>
              <Input
                id="person-phone"
                disabled={mutation.isPending}
                {...field}
                value={field.value ?? ""}
              />
              {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="notes"
          render={({ field, fieldState }) => (
            <Field data-invalid={!!fieldState.error}>
              <FieldLabel htmlFor="person-notes">Notes</FieldLabel>
              <Input
                id="person-notes"
                placeholder="Optional"
                disabled={mutation.isPending}
                {...field}
                value={field.value ?? ""}
              />
              {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
            </Field>
          )}
        />
      </FieldGroup>
    </FormDialog>
  );
}
