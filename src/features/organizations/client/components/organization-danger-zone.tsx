"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm-dialog";
import { selectOne } from "@/components/common/select-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OrgRole } from "@/features/organizations";
import { trpc } from "@/utils/trpc";

/**
 * The three irreversible actions, kept together and away from the ordinary
 * settings above them.
 *
 * Each one goes through `confirm()`; transfer additionally goes through
 * `selectOne()` — two shared dialogs, no local dialog state in this file.
 *
 * The dialog is awaited, the mutation is not: confirming is a question, so it
 * blocks, while the outcome is reported by the mutation's own callbacks like
 * every other mutation in the template.
 */
export function OrganizationDangerZone({
  organizationId,
  currentUserRole,
  currentUserId,
}: {
  organizationId: number;
  currentUserRole: OrgRole;
  currentUserId?: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const isOwner = currentUserRole === OrgRole.OWNER;

  const afterLeaving = async () => {
    await Promise.all([
      utils.organization.listMine.invalidate(),
      utils.organization.list.invalidate(),
      utils.organization.search.invalidate(),
    ]);
    router.push("/dashboard/orgs");
  };

  const deleteMutation = trpc.organization.delete.useMutation({
    onSuccess: async () => {
      toast.success("Organization deleted");
      await afterLeaving();
    },
    onError: (e) => toast.error(e.message),
  });

  const leaveMutation = trpc.organization.leave.useMutation({
    onSuccess: async () => {
      toast.success("You left the organization");
      await afterLeaving();
    },
    onError: (e) => toast.error(e.message),
  });

  const transferMutation = trpc.organization.transferOwnership.useMutation({
    onSuccess: async () => {
      toast.success("Ownership transferred");
      await Promise.all([
        utils.organization.getById.invalidate({ id: organizationId }),
        utils.organization.listMembers.invalidate({ organizationId }),
        utils.organization.listMine.invalidate(),
        utils.organization.list.invalidate(),
        utils.organization.search.invalidate(),
      ]);
    },
    onError: (e) => toast.error(e.message),
  });

  const members = trpc.organization.listMembers.useQuery({ organizationId }, { enabled: isOwner });

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete this organization?",
      description:
        "Every membership goes with it. This cannot be undone, and the slug becomes available to anyone.",
      confirmLabel: "Delete organization",
      destructive: true,
    });
    if (!ok) return;

    deleteMutation.mutate({ id: organizationId });
  };

  const handleLeave = async () => {
    const ok = await confirm({
      title: "Leave this organization?",
      description: "You lose access immediately. An owner or admin would have to add you back.",
      confirmLabel: "Leave",
      destructive: true,
    });
    if (!ok) return;

    leaveMutation.mutate({ organizationId });
  };

  const handleTransfer = async () => {
    const candidates = (members.data ?? [])
      .filter((m) => m.user.id !== currentUserId)
      .map((m) => ({ id: m.user.id, label: `${m.user.name} · ${m.user.email}` }));

    if (candidates.length === 0) {
      toast.error("Add another member first — there is no one to transfer to.");
      return;
    }

    const picked = await selectOne<{ id: string; label: string }>({
      title: "Transfer ownership",
      description: "They become the owner; you stay on as an admin.",
      valueKey: "id",
      renderText: (m) => m.label,
      // Already loaded, so this filters in memory rather than round-tripping.
      searchFn: async (search) =>
        candidates.filter((c) => c.label.toLowerCase().includes(search.toLowerCase())),
      confirmLabel: "Transfer",
    });
    if (!picked) return;

    const ok = await confirm({
      title: `Make ${picked.label.split(" · ")[0]} the owner?`,
      description: "You will be demoted to admin and cannot undo this yourself.",
      confirmLabel: "Transfer ownership",
      destructive: true,
    });
    if (!ok) return;

    transferMutation.mutate({ organizationId, toUserId: picked.id });
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>These actions cannot be undone.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {isOwner ? (
          <>
            <Button variant="outline" onClick={handleTransfer}>
              Transfer ownership
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete organization
            </Button>
          </>
        ) : (
          <Button variant="destructive" onClick={handleLeave}>
            Leave organization
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
