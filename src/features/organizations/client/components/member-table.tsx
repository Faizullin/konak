"use client";

import { LoaderIcon, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm-nice-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ORG_ROLE_LABELS, OrgRole, canManageMembers } from "@/features/organizations";
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
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">(OrgRole.MEMBER);

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
      setEmail("");
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateRole = trpc.organization.updateMemberRole.useMutation({
    onSuccess: async () => {
      toast.success("Role updated");
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMember = trpc.organization.removeMember.useMutation({
    onSuccess: async () => {
      toast.success("Member removed");
      await refresh();
    },
    onError: (e) => toast.error(e.message),
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
      {canManage && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addMember.mutate({ organizationId, email, role });
          }}
        >
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            className="min-w-56 flex-1"
            aria-label="Email of the person to add"
          />
          <Select
            items={ORG_ROLE_LABELS}
            value={role}
            onValueChange={(v) => setRole(v as "ADMIN" | "MEMBER")}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={OrgRole.MEMBER}>Member</SelectItem>
              <SelectItem value={OrgRole.ADMIN}>Admin</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={addMember.isPending || !email}>
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
