"use client";

import { useTranslations } from "next-intl";
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
import { CHANNEL_CODES, connectionFormSchema, type ConnectionFormInput } from "@/features/channels";
import { useErrorHandlers } from "@/lib/errors";
import { useZodResolver } from "@/lib/form";
import { trpc } from "@/utils/trpc";

/** Create a channel connection or rotate its credential pointer. */

export interface ChannelConnectionFormNiceDialogProps {
  propertyId: number;
  connectionId?: number;
}

export const ChannelConnectionFormNiceDialog = NiceModal.create(
  ({ propertyId, connectionId }: ChannelConnectionFormNiceDialogProps) => {
    const t = useTranslations("channels");
    const { handleFormError } = useErrorHandlers();
    const isEdit = connectionId !== undefined;
    const modal = useModal();
    const utils = trpc.useUtils();

    const empty: ConnectionFormInput = {
      provider: "",
      channelCode: "BOOKING_COM",
      externalPropertyId: undefined,
      credentialsRef: undefined,
    };

    const resolver = useZodResolver<ConnectionFormInput>(connectionFormSchema);

    const form = useForm<ConnectionFormInput>({ resolver, defaultValues: empty });

    const { data: connections } = trpc.channel.list.useQuery(
      { propertyId },
      { enabled: modal.visible && isEdit }
    );
    const existing = connections?.find((connection) => connection.id === connectionId);

    useEffect(() => {
      if (!modal.visible) return;
      form.reset(
        existing
          ? {
              provider: existing.provider,
              channelCode: existing.channelCode as ConnectionFormInput["channelCode"],
              externalPropertyId: existing.externalPropertyId ?? undefined,
              credentialsRef: existing.credentialsRef ?? undefined,
            }
          : empty
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modal.visible, existing, form]);

    const done = (message: string) => {
      toast.success(message);
      utils.channel.list.invalidate();
      modal.hide();
    };

    const create = trpc.channel.create.useMutation({
      onSuccess: () => done(t("form.created")),
      onError: (error) => handleFormError(form, error),
    });
    const setCredentials = trpc.channel.setCredentials.useMutation({
      onSuccess: () => done(t("form.saved")),
      onError: (error) => handleFormError(form, error),
    });
    const pending = create.isPending || setCredentials.isPending;

    return (
      <FormDialog
        open={modal.visible}
        onOpenChange={(open) => !open && modal.hide()}
        title={isEdit ? t("form.editTitle") : t("form.newTitle")}
        onSubmit={form.handleSubmit((values) =>
          isEdit
            ? setCredentials.mutate({
                propertyId,
                id: connectionId,
                externalPropertyId: values.externalPropertyId,
                credentialsRef: values.credentialsRef,
              })
            : create.mutate({ ...values, propertyId })
        )}
        error={form.formState.errors.root?.message}
        isLoading={pending}
        submitText={isEdit ? t("form.save") : t("form.add")}
      >
        <FieldGroup>
          <Controller
            control={form.control}
            name="channelCode"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel>{t("form.channel")}</FieldLabel>
                <Select
                  items={Object.fromEntries(
                    CHANNEL_CODES.map((code) => [code, t(`codes.${code}`)])
                  )}
                  value={field.value}
                  onValueChange={field.onChange}
                  // Immutable once connected: the mappings and the mirror hang
                  // off this connection, and a different OTA would inherit both.
                  disabled={pending || isEdit}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string) =>
                        (CHANNEL_CODES as readonly string[]).includes(v)
                          ? t(`codes.${v as (typeof CHANNEL_CODES)[number]}`)
                          : v
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {t(`codes.${code}`)}
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
            name="provider"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="provider">{t("form.provider")}</FieldLabel>
                <Input id="provider" {...field} disabled={pending || isEdit} />
                <FieldDescription>{t("form.providerHint")}</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="externalPropertyId"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="externalPropertyId">{t("form.externalPropertyId")}</FieldLabel>
                <Input
                  id="externalPropertyId"
                  value={field.value ?? ""}
                  // Empty is absent, not "". The schema's `.optional()` would
                  // refuse an empty string and the router would store one.
                  onChange={(event) => field.onChange(event.target.value || undefined)}
                  onBlur={field.onBlur}
                  disabled={pending}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="credentialsRef"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="credentialsRef">{t("form.credentialsRef")}</FieldLabel>
                <Input
                  id="credentialsRef"
                  value={field.value ?? ""}
                  onChange={(event) => field.onChange(event.target.value || undefined)}
                  onBlur={field.onBlur}
                  disabled={pending}
                  className="font-mono"
                />
                <FieldDescription>{t("form.credentialsRefHint")}</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </FieldGroup>
      </FormDialog>
    );
  }
);
