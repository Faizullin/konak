"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { LoaderIcon, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm-nice-dialog";
import { FormError } from "@/components/common/form-error";
import { DataTable } from "@/components/data-table/data-table";
import { useDataTable } from "@/components/data-table/use-data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ORG_ROLE_VALUES,
  OrgRole,
  addMemberFormSchema,
  canManageMembers,
  type AddMemberFormInput,
} from "@/features/organizations";
import { useErrorHandlers } from "@/lib/errors";
import { useZodResolver } from "@/lib/form";
import { useEnumLabels } from "@/lib/labels";
import type { GeneralRouterOutputs } from "@/server/types";
import { trpc } from "@/utils/trpc";

type MemberRow = GeneralRouterOutputs["organization"]["listMembers"][number];

/**
 * The member list, and the three things you do to it: add, change a role, remove.
 */
export function MemberTable({
  organizationId,
  currentUserRole,
  currentUserId,
}: {
  organizationId: number;
  currentUserRole: OrgRole;
  currentUserId?: string;
}) {
  const labels = useEnumLabels("orgRole", ORG_ROLE_VALUES);
  const t = useTranslations("organizations");
  const { handleError, handleFormError } = useErrorHandlers();
  const utils = trpc.useUtils();

  const resolver = useZodResolver<AddMemberFormInput>(addMemberFormSchema);

  const form = useForm<AddMemberFormInput>({
    resolver,
    defaultValues: { email: "", role: OrgRole.MEMBER },
  });

  const members = trpc.organization.listMembers.useQuery({ organizationId });
  const canManage = canManageMembers(currentUserRole);

  const refresh = async () => {
    await Promise.all([
      utils.organization.listMembers.invalidate({ organizationId }),
      utils.organization.getById.invalidate({ id: organizationId }),
      utils.organization.listMine.invalidate(),
      utils.organization.list.invalidate(),
    ]);
  };

  const addMember = trpc.organization.addMember.useMutation({
    onSuccess: async () => {
      toast.success(t("members.added"));
      form.reset();
      await refresh();
    },
    onError: (e) => handleFormError(form, e),
  });

  const updateRole = trpc.organization.updateMemberRole.useMutation({
    onSuccess: async () => {
      toast.success(t("members.roleUpdated"));
      await refresh();
    },
    onError: (e) => handleError(e),
  });

  const removeMember = trpc.organization.removeMember.useMutation({
    onSuccess: async () => {
      toast.success(t("members.removed"));
      await refresh();
    },
    onError: (e) => handleError(e),
  });

  // Stable, so the column definitions below can depend on it honestly.
  const handleRemove = useCallback(
    async (userId: string, name: string) => {
      const ok = await confirm({
        title: `Remove ${name}?`,
        description:
          "They lose access to this organization immediately. You can add them back later.",
        confirmLabel: t("members.remove"),
        destructive: true,
      });
      if (ok) removeMember.mutate({ organizationId, userId });
    },
    [organizationId, removeMember, t]
  );

  const columns = useMemo<ColumnDef<MemberRow>[]>(
    () => [
      {
        id: "user",
        header: t("members.member"),
        cell: ({ row }) => {
          const member = row.original;
          const isSelf = member.user.id === currentUserId;

          return (
            <div>
              <div className="font-medium">
                {member.user.name}
                {isSelf && <span className="text-muted-foreground"> (you)</span>}
              </div>
              <div className="text-muted-foreground text-xs">{member.user.email}</div>
            </div>
          );
        },
      },
      {
        id: "role",
        header: t("members.role"),
        cell: ({ row }) => {
          const member = row.original;
          const isOwner = member.role === OrgRole.OWNER;

          // Owner's role is not editable here — only transferred in Danger Zone.
          if (canManage && !isOwner) {
            return (
              <Select
                items={labels}
                value={member.role}
                onValueChange={(v) =>
                  updateRole.mutate({
                    organizationId,
                    userId: member.user.id,
                    role: v as "ADMIN" | "MEMBER",
                  })
                }
              >
                <SelectTrigger className="w-32" size="sm">
                  <SelectValue>{(v: OrgRole) => labels[v] ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OrgRole.MEMBER}>{labels[OrgRole.MEMBER]}</SelectItem>
                  <SelectItem value={OrgRole.ADMIN}>{labels[OrgRole.ADMIN]}</SelectItem>
                </SelectContent>
              </Select>
            );
          }

          return <Badge variant={isOwner ? "default" : "secondary"}>{labels[member.role]}</Badge>;
        },
      },
      {
        id: "actions",
        header: () => <div className="text-right">{t("members.actions")}</div>,
        cell: ({ row }) => {
          const member = row.original;
          const isOwner = member.role === OrgRole.OWNER;
          const isSelf = member.user.id === currentUserId;

          if (!canManage || isOwner || isSelf) return null;

          return (
            <div className="text-right">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemove(member.user.id, member.user.name)}
              >
                {t("members.remove")}
              </Button>
            </div>
          );
        },
      },
    ],
    [canManage, currentUserId, handleRemove, labels, organizationId, t, updateRole]
  );

  const { table } = useDataTable({
    columns,
    data: members.data ?? [],
    getRowId: (row) => String(row.id),
  });

  return (
    <div className="space-y-4">
      <FormError message={form.formState.errors.root?.message} />

      {canManage && (
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={form.handleSubmit((values) => addMember.mutate({ organizationId, ...values }))}
        >
          <Controller
            control={form.control}
            name="email"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error} className="min-w-56 flex-1">
                <Input
                  type="email"
                  placeholder={t("members.emailPlaceholder")}
                  aria-label={t("members.emailLabel")}
                  disabled={addMember.isPending}
                  {...field}
                />
                {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="role"
            render={({ field }) => (
              <Select
                items={labels}
                value={field.value}
                onValueChange={field.onChange}
                disabled={addMember.isPending}
              >
                <SelectTrigger className="w-32">
                  <SelectValue>{(v: OrgRole) => labels[v] ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OrgRole.MEMBER}>{labels[OrgRole.MEMBER]}</SelectItem>
                  <SelectItem value={OrgRole.ADMIN}>{labels[OrgRole.ADMIN]}</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          <Button type="submit" disabled={addMember.isPending}>
            {addMember.isPending ? (
              <LoaderIcon className="size-4 animate-spin" />
            ) : (
              <UserPlus className="size-4" />
            )}
            Add
          </Button>
        </form>
      )}

      {members.isLoading ? <Skeleton className="h-40" /> : <DataTable table={table} />}
    </div>
  );
}
