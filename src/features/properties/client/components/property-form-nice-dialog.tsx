"use client";

import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormDialog } from "@/components/common/form-dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { propertyFormSchema, type PropertyFormInput } from "@/features/properties";
import { useErrorHandlers } from "@/lib/errors";
import { useZodResolver } from "@/lib/form";
import { trpc } from "@/utils/trpc";

/**
 * A new hotel.
 *
 * The timezone is a field rather than a default because it is not cosmetic: a
 * hotel's day ends at its front desk, and *"has this booking arrived yet"* is
 * answered against the property's own day or answered wrongly twice a day. The
 * currency is the same kind of decision — every price beneath it is in it.
 */

export interface PropertyFormNiceDialogProps {
  organizationId: number;
  orgSlug: string;
}

/** Nothing here carries a schema `.default()`, so these are the only defaults. */
const EMPTY: PropertyFormInput = {
  name: "",
  slug: "",
  // The browser's own zone is right far more often than not, and wrong in a way
  // the person filling this in can see.
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  currencyCode: "EUR",
  checkInMinutes: 840,
  checkOutMinutes: 660,
};

export const PropertyFormNiceDialog = NiceModal.create(
  ({ organizationId, orgSlug }: PropertyFormNiceDialogProps) => {
    const t = useTranslations("properties");
    const { handleFormError } = useErrorHandlers();
    const modal = useModal();
    const router = useRouter();

    const resolver = useZodResolver<PropertyFormInput>(propertyFormSchema);
    const form = useForm<PropertyFormInput>({ resolver, defaultValues: EMPTY });

    useEffect(() => {
      if (modal.visible) form.reset(EMPTY);
    }, [modal.visible, form]);

    const create = trpc.property.create.useMutation({
      onSuccess: (property) => {
        toast.success(t("propertyForm.created"));
        modal.hide();
        // Straight into it: the next thing anybody does is add room types.
        router.push(`/dashboard/orgs/${orgSlug}/front-desk/${property.slug}/setup`);
      },
      onError: (error) => handleFormError(form, error),
    });

    return (
      <FormDialog
        open={modal.visible}
        onOpenChange={(open) => !open && modal.hide()}
        title={t("propertyForm.title")}
        description={t("propertyForm.description")}
        onSubmit={form.handleSubmit((values) => create.mutate({ ...values, organizationId }))}
        error={form.formState.errors.root?.message}
        isLoading={create.isPending}
        submitText={t("propertyForm.add")}
      >
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Text control={form.control} name="name" label={t("propertyForm.name")} />
            <Text control={form.control} name="slug" label={t("propertyForm.slug")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Text control={form.control} name="timezone" label={t("propertyForm.timezone")} />
            <Text
              control={form.control}
              name="currencyCode"
              label={t("propertyForm.currencyCode")}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Minutes
              control={form.control}
              name="checkInMinutes"
              label={t("propertyForm.checkIn")}
            />
            <Minutes
              control={form.control}
              name="checkOutMinutes"
              label={t("propertyForm.checkOut")}
            />
          </div>
        </FieldGroup>
      </FormDialog>
    );
  }
);

function Text({
  control,
  name,
  label,
}: {
  control: ReturnType<typeof useForm<PropertyFormInput>>["control"];
  name: "name" | "slug" | "timezone" | "currencyCode";
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={!!fieldState.error}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input id={name} {...field} />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

/** Minutes from midnight — 840 is 14:00. Typed as a time, stored as a number. */
function Minutes({
  control,
  name,
  label,
}: {
  control: ReturnType<typeof useForm<PropertyFormInput>>["control"];
  name: "checkInMinutes" | "checkOutMinutes";
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={!!fieldState.error}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            id={name}
            type="time"
            value={`${String(Math.floor(field.value / 60)).padStart(2, "0")}:${String(field.value % 60).padStart(2, "0")}`}
            onChange={(event) => {
              const [hours, minutes] = event.target.value.split(":").map(Number);
              if (Number.isFinite(hours) && Number.isFinite(minutes)) {
                field.onChange(hours! * 60 + minutes!);
              }
            }}
          />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
