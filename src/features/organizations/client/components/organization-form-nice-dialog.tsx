"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { LoaderIcon } from "lucide-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  createOrganizationSchema,
  slugify,
  type CreateOrganizationInput,
} from "@/features/organizations";
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
    const isEdit = mode === "edit";
    const modal = useModal();
    const utils = trpc.useUtils();

    const form = useForm<CreateOrganizationInput>({
      resolver: zodResolver(createOrganizationSchema),
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
        toast.success("Organization created");
        await close();
      },
      onError: (e) => toast.error(e.message),
    });

    const updateMutation = trpc.organization.update.useMutation({
      onSuccess: async () => {
        toast.success("Organization updated");
        await close();
      },
      onError: (e) => toast.error(e.message),
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
      <Dialog open={modal.visible} onOpenChange={(open) => !open && modal.hide()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Organization settings" : "New organization"}</DialogTitle>
            <DialogDescription>
              The slug appears in URLs and must be unique across the install.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FieldGroup>
              <Controller
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor="org-name">Name</FieldLabel>
                    <Input
                      id="org-name"
                      placeholder="Acme Inc."
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
                    <FieldLabel htmlFor="org-slug">Slug</FieldLabel>
                    <Input id="org-slug" placeholder="acme" {...field} />
                    {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="description"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor="org-description">Description</FieldLabel>
                    <Input
                      id="org-description"
                      placeholder="Optional"
                      {...field}
                      value={field.value ?? ""}
                    />
                    {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                  </Field>
                )}
              />
            </FieldGroup>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => modal.hide()}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <LoaderIcon className="size-4 animate-spin" />}
                {isEdit ? "Save changes" : "Create organization"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }
);
