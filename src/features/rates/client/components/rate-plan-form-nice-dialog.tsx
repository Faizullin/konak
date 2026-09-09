"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormDialog } from "@/components/common/form-dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MEAL_PLAN_LABELS, ratePlanFormSchema, type RatePlanFormInput } from "@/features/rates";
import { useErrorHandlers } from "@/lib/errors";
import { trpc } from "@/utils/trpc";

/**
 * Add or edit a rate plan — the terms around a price, not the price itself.
 *
 * Nightly amounts live in the rate calendar; what a plan owns is what a guest
 * is choosing between when two plans quote the same room.
 */

export interface RatePlanFormNiceDialogProps {
  propertyId: number;
  /** The property's currency, so a new plan starts in the right one. */
  currencyCode: string;
  planId?: number;
}

/** All room types, which is what a plan with no room type means. */
const EVERY_TYPE = "ALL";

export const RatePlanFormNiceDialog = NiceModal.create(
  ({ propertyId, currencyCode, planId }: RatePlanFormNiceDialogProps) => {
    const { handleFormError } = useErrorHandlers();
    const isEdit = planId !== undefined;
    const modal = useModal();
    const utils = trpc.useUtils();

    const empty: RatePlanFormInput = {
      roomTypeId: null,
      name: "",
      code: "",
      currencyCode,
      mealPlan: "ROOM_ONLY",
      isRefundable: true,
      cancellationCutoffHours: 24,
      cancellationPolicy: "",
      extraAdultMinor: 0,
      extraChildMinor: 0,
      defaultMinLengthOfStay: 1,
    };

    const form = useForm<RatePlanFormInput>({
      resolver: zodResolver(ratePlanFormSchema),
      defaultValues: empty,
    });

    const { data: types } = trpc.property.listRoomTypes.useQuery(
      { propertyId },
      { enabled: modal.visible }
    );
    const { data: plans } = trpc.rate.listPlans.useQuery(
      { propertyId, includeArchived: true },
      { enabled: modal.visible && isEdit }
    );
    const existing = plans?.find((plan) => plan.id === planId);

    useEffect(() => {
      if (!modal.visible) return;
      form.reset(
        existing
          ? {
              roomTypeId: existing.roomTypeId,
              name: existing.name,
              code: existing.code,
              currencyCode: existing.currencyCode,
              mealPlan: existing.mealPlan as RatePlanFormInput["mealPlan"],
              isRefundable: existing.isRefundable,
              cancellationCutoffHours: existing.cancellationCutoffHours,
              cancellationPolicy: existing.cancellationPolicy ?? "",
              extraAdultMinor: existing.extraAdultMinor,
              extraChildMinor: existing.extraChildMinor,
              defaultMinLengthOfStay: existing.defaultMinLengthOfStay,
            }
          : empty
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modal.visible, existing, form]);

    const done = (verb: string) => {
      toast.success(`Rate plan ${verb}`);
      utils.rate.listPlans.invalidate();
      modal.hide();
    };

    const create = trpc.rate.createPlan.useMutation({
      onSuccess: () => done("added"),
      onError: (error) => handleFormError(form, error),
    });
    const update = trpc.rate.updatePlan.useMutation({
      onSuccess: () => done("saved"),
      onError: (error) => handleFormError(form, error),
    });
    const pending = create.isPending || update.isPending;

    const refundable = form.watch("isRefundable");

    return (
      <FormDialog
        open={modal.visible}
        onOpenChange={(open) => !open && modal.hide()}
        title={isEdit ? "Edit rate plan" : "New rate plan"}
        onSubmit={form.handleSubmit((values) =>
          isEdit
            ? update.mutate({ ...values, propertyId, id: planId })
            : create.mutate({ ...values, propertyId })
        )}
        error={form.formState.errors.root?.message}
        isLoading={pending}
        submitText={isEdit ? "Save" : "Add rate plan"}
      >
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor="name">Name</FieldLabel>
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
                  <FieldLabel htmlFor="code">Code</FieldLabel>
                  <Input
                    id="code"
                    {...field}
                    onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                    disabled={pending}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </div>

          <Controller
            control={form.control}
            name="roomTypeId"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel>Applies to</FieldLabel>
                <Select
                  items={{
                    [EVERY_TYPE]: "Every room type",
                    ...Object.fromEntries((types ?? []).map((t) => [String(t.id), t.name])),
                  }}
                  value={field.value === null ? EVERY_TYPE : String(field.value)}
                  onValueChange={(value) =>
                    field.onChange(value === EVERY_TYPE ? null : Number(value))
                  }
                  disabled={pending}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EVERY_TYPE}>Every room type</SelectItem>
                    {(types ?? []).map((type) => (
                      <SelectItem key={type.id} value={String(type.id)}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="mealPlan"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel>Meal plan</FieldLabel>
                <Select
                  items={MEAL_PLAN_LABELS}
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={pending}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MEAL_PLAN_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="isRefundable"
            render={({ field }) => (
              <Field>
                <FieldLabel>Cancellation</FieldLabel>
                <Select
                  items={{ yes: "Refundable", no: "Non-refundable" }}
                  value={field.value ? "yes" : "no"}
                  onValueChange={(value) => {
                    const isRefundable = value === "yes";
                    field.onChange(isRefundable);
                    // A non-refundable plan has no free window, and the server
                    // refuses the pair — so the form clears it rather than
                    // letting someone submit a contradiction.
                    form.setValue("cancellationCutoffHours", isRefundable ? 24 : null);
                  }}
                  disabled={pending}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Refundable</SelectItem>
                    <SelectItem value="no">Non-refundable</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          />

          {refundable && (
            <Controller
              control={form.control}
              name="cancellationCutoffHours"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor="cutoff">Free until, hours before arrival</FieldLabel>
                  <Input
                    id="cutoff"
                    type="number"
                    min={0}
                    value={field.value ?? 0}
                    onChange={(event) => field.onChange(event.target.valueAsNumber)}
                    onBlur={field.onBlur}
                    disabled={pending}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["extraAdultMinor", "Extra adult"],
                ["extraChildMinor", "Extra child"],
                ["defaultMinLengthOfStay", "Min nights"],
              ] as const
            ).map(([name, label]) => (
              <Controller
                key={name}
                control={form.control}
                name={name}
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor={name}>{label}</FieldLabel>
                    <Input
                      id={name}
                      type="number"
                      min={0}
                      value={Number.isNaN(field.value) ? "" : field.value}
                      onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      onBlur={field.onBlur}
                      disabled={pending}
                    />
                    {name !== "defaultMinLengthOfStay" && (
                      // Minor units, said plainly. A money input is a Phase 6
                      // decision, and inventing one here would be a second
                      // convention for the same thing.
                      <FieldDescription>In minor units, e.g. 2500 = 25.00</FieldDescription>
                    )}
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
