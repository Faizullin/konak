"use client";

import { useTranslations } from "next-intl";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormDialog } from "@/components/common/form-dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mappingFormSchema, type MappingFormInput } from "@/features/channels";
import { useErrorHandlers } from "@/lib/errors";
import { useZodResolver } from "@/lib/form";
import { trpc } from "@/utils/trpc";

/** Map a property room type and optional rate plan to what an OTA calls them. */

export interface ChannelMappingFormNiceDialogProps {
  propertyId: number;
  connectionId: number;
  /** Present when editing: the pair is then fixed, and only the ids move. */
  mapping?: {
    roomTypeId: number;
    ratePlanId: number | null;
    externalRoomTypeId: string;
    externalRatePlanId: string | null;
  };
}

/** Every plan, which is what a mapping with no rate plan means. */
const EVERY_PLAN = "ALL";

export const ChannelMappingFormNiceDialog = NiceModal.create(
  ({ propertyId, connectionId, mapping }: ChannelMappingFormNiceDialogProps) => {
    const t = useTranslations("channels");
    const { handleFormError } = useErrorHandlers();
    const isEdit = mapping !== undefined;
    const modal = useModal();
    const utils = trpc.useUtils();

    const resolver = useZodResolver<MappingFormInput>(mappingFormSchema);

    const form = useForm<MappingFormInput>({
      resolver,
      defaultValues: {
        roomTypeId: 0,
        ratePlanId: undefined,
        externalRoomTypeId: "",
        externalRatePlanId: undefined,
      },
    });

    const { data: types } = trpc.property.listRoomTypes.useQuery(
      { propertyId },
      { enabled: modal.visible }
    );
    const { data: plans } = trpc.rate.listPlans.useQuery(
      { propertyId, includeArchived: false },
      { enabled: modal.visible }
    );

    useEffect(() => {
      if (!modal.visible) return;
      // Re-seeding a form someone has already typed into would throw the typing
      // away — and `types` arriving late is exactly when that would happen.
      if (form.formState.isDirty) return;
      form.reset(
        mapping
          ? {
              roomTypeId: mapping.roomTypeId,
              ratePlanId: mapping.ratePlanId ?? undefined,
              externalRoomTypeId: mapping.externalRoomTypeId,
              externalRatePlanId: mapping.externalRatePlanId ?? undefined,
            }
          : {
              roomTypeId: types?.[0]?.id ?? 0,
              ratePlanId: undefined,
              externalRoomTypeId: "",
              externalRatePlanId: undefined,
            }
      );
    }, [modal.visible, mapping, types, form]);

    const map = trpc.channel.map.useMutation({
      onSuccess: () => {
        toast.success(t("mappingForm.saved"));
        utils.channel.list.invalidate();
        modal.hide();
      },
      onError: (error) => handleFormError(form, error),
    });

    return (
      <FormDialog
        open={modal.visible}
        onOpenChange={(open) => !open && modal.hide()}
        title={isEdit ? t("mappingForm.editTitle") : t("mappingForm.newTitle")}
        onSubmit={form.handleSubmit((values) =>
          map.mutate({ ...values, propertyId, connectionId })
        )}
        error={form.formState.errors.root?.message}
        isLoading={map.isPending}
        submitText={isEdit ? t("mappingForm.save") : t("mappingForm.add")}
      >
        <FieldGroup>
          <Controller
            control={form.control}
            name="roomTypeId"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel>{t("mappingForm.roomType")}</FieldLabel>
                <Select
                  items={Object.fromEntries(
                    (types ?? []).map((type) => [String(type.id), type.name])
                  )}
                  value={String(field.value)}
                  onValueChange={(value) => field.onChange(Number(value))}
                  disabled={map.isPending || isEdit}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string) => types?.find((t) => String(t.id) === v)?.name ?? v}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
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
            name="ratePlanId"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel>{t("mappingForm.ratePlan")}</FieldLabel>
                <Select
                  items={{
                    [EVERY_PLAN]: t("mappingForm.everyRatePlan"),
                    ...Object.fromEntries(
                      (plans ?? []).map((plan) => [String(plan.id), plan.name])
                    ),
                  }}
                  value={field.value === undefined ? EVERY_PLAN : String(field.value)}
                  onValueChange={(value) =>
                    field.onChange(value === EVERY_PLAN ? undefined : Number(value))
                  }
                  disabled={map.isPending || isEdit}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string) =>
                        v === EVERY_PLAN
                          ? t("mappingForm.everyRatePlan")
                          : (plans?.find((p) => String(p.id) === v)?.name ?? v)
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EVERY_PLAN}>{t("mappingForm.everyRatePlan")}</SelectItem>
                    {(plans ?? []).map((plan) => (
                      <SelectItem key={plan.id} value={String(plan.id)}>
                        {plan.name}
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
            name="externalRoomTypeId"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="externalRoomTypeId">
                  {t("mappingForm.externalRoomTypeId")}
                </FieldLabel>
                <Input id="externalRoomTypeId" {...field} disabled={map.isPending} />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="externalRatePlanId"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="externalRatePlanId">
                  {t("mappingForm.externalRatePlanId")}
                </FieldLabel>
                <Input
                  id="externalRatePlanId"
                  value={field.value ?? ""}
                  onChange={(event) => field.onChange(event.target.value || undefined)}
                  onBlur={field.onBlur}
                  disabled={map.isPending}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </FieldGroup>
      </FormDialog>
    );
  }
);
