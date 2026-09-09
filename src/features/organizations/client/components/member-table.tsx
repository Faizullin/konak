"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderIcon, UserPlus } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm-nice-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/common/form-error";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ORG_ROLE_LABELS,
  OrgRole,
  addMemberFormSchema,
  canManageMembers,
  type AddMemberFormInput,
} from "@/features/organizations";
import { useErrorHandlers } from "@/lib/errors";
import { trpc } from "@/utils/trpc";

/**
 * The member list, and the three things you do to it: add, change a role,
 * remove.
 *
 * Every control is gated on `currentUserRole` — but only for the UI. The
 * router re-checks each one, so hiding a button is a courtesy, never the
 * enforcement.
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
  const { handleError, handleFormError } = useErrorHandlers();
  const utils = trpc.useUtils();

  // Bound to the router's own schema, so a typo'd email is refused here with a
  // message under the field rather than as a toast after a round trip.
  const form = useForm<AddMemberFormInput>({
    resolver: zodResolver(addMemberFormSchema),
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
      toast.success("Member added");
      form.reset();
      await refresh();
    },
    // "No account with that email" and "already a member" both name the email
    // field on the server, so both land under the input the person just typed.
    onError: (e) => handleFormError(form, e),
  });

  const updateRole = trpc.organization.updateMemberRole.useMutation({
    onSuccess: async () => {
      toast.success("Role updated");
      await refresh();
    },
    onError: (e) => handleError(e),
  });

  const removeMember = trpc.organization.removeMember.useMutation({
    onSuccess: async () => {
      toast.success("Member removed");
      await refresh();
    },
    onError: (e) => handleError(e),
  });

  const handleRemove = async (userId: string, name: string) => {
    const ok = await confirm({
      title: `Remove ${name}?`,
      description:
        "They lose access to this organization immediately. You can add them back later.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) removeMember.mutate({ organizationId, userId });
  };

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
                  placeholder="person@example.com"
                  aria-label="Email of the person to add"
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
                items={ORG_ROLE_LABELS}
                value={field.value}
                onValueChange={field.onChange}
                disabled={addMember.isPending}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OrgRole.MEMBER}>Member</SelectItem>
                  <SelectItem value={OrgRole.ADMIN}>Admin</SelectItem>
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

      {members.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.data?.map((member) => {
              const isOwner = member.role === OrgRole.OWNER;
              const isSelf = member.user.id === currentUserId;

              return (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="font-medium">
                      {member.user.name}
                      {isSelf && <span className="text-muted-foreground"> (you)</span>}
                    </div>
                    <div className="text-muted-foreground text-xs">{member.user.email}</div>
                  </TableCell>
                  <TableCell>
                    {/* The owner's role is not editable here — it moves only
                        through transfer, which changes both sides at once. */}
                    {canManage && !isOwner ? (
                      <Select
                        items={ORG_ROLE_LABELS}
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
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={OrgRole.MEMBER}>Member</SelectItem>
                          <SelectItem value={OrgRole.ADMIN}>Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={isOwner ? "default" : "secondary"}>
                        {ORG_ROLE_LABELS[member.role]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && !isOwner && !isSelf && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(member.user.id, member.user.name)}
                      >
                        Remove
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
