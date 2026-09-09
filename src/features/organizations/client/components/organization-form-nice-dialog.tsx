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
  createOrganizationSchema,
  slugify,
  type CreateOrganizationInput,
} from "@/features/organizations";
import { useErrorHandlers } from "@/lib/errors";
import { useZodResolver } from "@/lib/form";
import { trpc } from "@/utils/trpc";

/**
 * Create or rename an organization.
 *
 * One dialog for both, because the fields are identical and a second copy
 * would drift. `mode` picks the mutation and the wording; everything else is
 * shared. Validation comes from `createOrganizationSchema` in `model/` — the
 * same object the router validates against, so the form cannot accept
 * something the server will reject.
 */

export interface OrganizationFormNiceDialogProps {
  mode?: "create" | "edit";
  organizationId?: number;
}

export const OrganizationFormNiceDialog = NiceModal.create(
  ({ mode = "create", organizationId }: OrganizationFormNiceDialogProps) => {
    const t = useTranslations("organizations");
    const { handleFormError } = useErrorHandlers();
    const isEdit = mode === "edit";
    const modal = useModal();
    const utils = trpc.useUtils();

    const resolver = useZodResolver<CreateOrganizationInput>(createOrganizationSchema);

    const form = useForm<CreateOrganizationInput>({
      resolver,
      defaultValues: { name: "", slug: "", description: "" },
    });

    const { data: existing } = trpc.organization.getById.useQuery(
      { id: organizationId ?? 0 },
      { enabled: modal.visible && isEdit && !!organizationId }
    );

    // Re-seed whenever the dialog opens, so a cancelled edit never leaks into
    // the next one.
    useEffect(() => {
      if (!modal.visible) return;
      form.reset(
        isEdit && existing
          ? {
              name: existing.name,
              slug: existing.slug,
              description: existing.description ?? "",
            }
          : { name: "", slug: "", description: "" }
      );
    }, [modal.visible, isEdit, existing, form]);

    const close = async () => {
      await Promise.all([
        utils.organization.listMine.invalidate(),
        utils.organization.list.invalidate(),
        utils.organization.search.invalidate(),
        isEdit && organizationId
          ? utils.organization.getById.invalidate({ id: organizationId })
          : Promise.resolve(),
      ]);
      modal.resolve(true);
      modal.hide();
    };

    const createMutation = trpc.organization.create.useMutation({
      onSuccess: async () => {
        toast.success(t("form.created"));
        await close();
      },
      // A taken slug arrives as a `ConflictError` naming "slug", and lands under the
      // slug box; anything else lands on the form.
      onError: (e) => handleFormError(form, e),
    });

    const updateMutation = trpc.organization.update.useMutation({
      onSuccess: async () => {
        toast.success(t("form.updated"));
        await close();
      },
      onError: (e) => handleFormError(form, e),
    });

    const mutation = isEdit ? updateMutation : createMutation;

    const onSubmit = (values: CreateOrganizationInput) => {
      if (isEdit && organizationId) {
        updateMutation.mutate({ id: organizationId, ...values });
        return;
      }
      createMutation.mutate(values);
    };

    return (
      <FormDialog
        open={modal.visible}
        onOpenChange={(open) => !open && modal.hide()}
        title={isEdit ? "Organization settings" : "New organization"}
        description="The slug appears in URLs and must be unique across the install."
        onSubmit={form.handleSubmit(onSubmit)}
        error={form.formState.errors.root?.message}
        isLoading={mutation.isPending}
        submitText={isEdit ? "Save changes" : "Create organization"}
      >
        <FieldGroup>
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="org-name">{t("form.name")}</FieldLabel>
                <Input
                  id="org-name"
                  placeholder={t("form.namePlaceholder")}
                  {...field}
                  onChange={(e) => {
                    field.onChange(e);
                    // Prefill the slug only while creating, and only while
                    // the person has not typed their own.
                    if (!isEdit && !form.formState.dirtyFields.slug) {
                      form.setValue("slug", slugify(e.target.value));
                    }
                  }}
                />
                {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="slug"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="org-slug">{t("form.slug")}</FieldLabel>
                <Input id="org-slug" placeholder={t("form.slugPlaceholder")} {...field} />
                {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="org-description">{t("form.description")}</FieldLabel>
                <Input
                  id="org-description"
                  placeholder={t("form.descriptionPlaceholder")}
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
);
