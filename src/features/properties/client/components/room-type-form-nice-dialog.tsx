"use client";

import { useTranslations } from "next-intl";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormDialog } from "@/components/common/form-dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { roomTypeFormSchema, type RoomTypeFormInput } from "@/features/properties";
import { useErrorHandlers } from "@/lib/errors";
import { useZodResolver } from "@/lib/form";
import { trpc } from "@/utils/trpc";

/**
 * Add or rename a room type — what a guest actually books.
 *
 * One dialog for both, because the fields are identical and a second copy would
 * drift. Validation is `roomTypeFormSchema` from `model/`, the same object the
 * router validates, so the form cannot accept an occupancy the server refuses.
 */

export interface RoomTypeFormNiceDialogProps {
  propertyId: number;
  /** Absent creates; present edits that type. */
  roomTypeId?: number;
}

const EMPTY: RoomTypeFormInput = {
  name: "",
  code: "",
  description: "",
  baseOccupancy: 2,
  maxOccupancy: 2,
  maxAdults: 2,
  maxChildren: 0,
  position: 0,
};

/** The numeric fields, in the order they read. Labels come from `typeForm.<name>`. */
const NUMBERS = ["baseOccupancy", "maxOccupancy", "maxAdults", "maxChildren", "position"] as const;

export const RoomTypeFormNiceDialog = NiceModal.create(
  ({ propertyId, roomTypeId }: RoomTypeFormNiceDialogProps) => {
    const t = useTranslations("properties");
    const { handleFormError } = useErrorHandlers();
    const isEdit = roomTypeId !== undefined;
    const modal = useModal();
    const utils = trpc.useUtils();

    const resolver = useZodResolver<RoomTypeFormInput>(roomTypeFormSchema);

    const form = useForm<RoomTypeFormInput>({
      resolver,
      defaultValues: EMPTY,
    });

    const { data: types } = trpc.property.listRoomTypes.useQuery(
      { propertyId, includeArchived: true },
      { enabled: modal.visible && isEdit }
    );
    const existing = types?.find((type) => type.id === roomTypeId);

    // Re-seed on open so a cancelled edit never leaks into the next one.
    useEffect(() => {
      if (!modal.visible) return;
      form.reset(
        existing
          ? {
              name: existing.name,
              code: existing.code,
              description: "",
              baseOccupancy: existing.baseOccupancy,
              maxOccupancy: existing.maxOccupancy,
              maxAdults: existing.maxAdults,
              maxChildren: existing.maxChildren,
              position: existing.position,
            }
          : EMPTY
      );
    }, [modal.visible, existing, form]);

    const done = (verb: string) => {
      toast.success(`Room type ${verb}`);
      utils.property.listRoomTypes.invalidate();
      modal.hide();
    };

    const create = trpc.property.createRoomType.useMutation({
      onSuccess: () => done("added"),
      onError: (error) => handleFormError(form, error),
    });
    const update = trpc.property.updateRoomType.useMutation({
      onSuccess: () => done("saved"),
      onError: (error) => handleFormError(form, error),
    });

    const pending = create.isPending || update.isPending;

    return (
      <FormDialog
        open={modal.visible}
        onOpenChange={(open) => !open && modal.hide()}
        title={isEdit ? t("typeForm.editTitle") : t("typeForm.newTitle")}
        description="A guest books a type; a room is assigned at check-in."
        onSubmit={form.handleSubmit((values) =>
          isEdit
            ? update.mutate({ ...values, propertyId, id: roomTypeId })
            : create.mutate({ ...values, propertyId })
        )}
        error={form.formState.errors.root?.message}
        isLoading={pending}
        submitText={isEdit ? t("typeForm.save") : t("typeForm.add")}
      >
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor="name">{t("typeForm.name")}</FieldLabel>
                  <Input id="name" {...field} disabled={pending} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="code"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor="code">{t("typeForm.code")}</FieldLabel>
                  <Input
                    id="code"
                    {...field}
                    // Upper-cased as it is typed: the schema refuses lower case,
                    // and correcting it after the fact reads as the form fighting.
                    onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                    disabled={pending}
                  />
                  {/* A description, not `FieldError` children — children win
                      over `errors` there, so a hint would hide the failure. */}
                  <FieldDescription>
                    What a channel maps to. It outlives renaming the type.
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {NUMBERS.map((name) => (
              <Controller
                key={name}
                control={form.control}
                name={name}
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor={name}>{t(`typeForm.${name}`)}</FieldLabel>
                    <Input
                      id={name}
                      type="number"
                      min={0}
                      value={Number.isNaN(field.value) ? "" : field.value}
                      onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      onBlur={field.onBlur}
                      disabled={pending}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            ))}
          </div>
        </FieldGroup>
      </FormDialog>
    );
  }
);
