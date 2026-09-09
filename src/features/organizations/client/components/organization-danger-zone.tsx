"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm-nice-dialog";
import { selectOne } from "@/components/common/select-nice-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OrgRole } from "@/features/organizations";
import { useErrorHandlers } from "@/lib/errors";
import { trpc } from "@/utils/trpc";

export function OrganizationDangerZone({
  organizationId,
  currentUserRole,
  currentUserId,
}: {
  organizationId: number;
  currentUserRole: OrgRole;
  currentUserId?: string;
}) {
  const t = useTranslations("organizations");
  const { handleError } = useErrorHandlers();
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
      toast.success(t("danger.deleted"));
      await afterLeaving();
    },
    onError: (e) => handleError(e),
  });

  const leaveMutation = trpc.organization.leave.useMutation({
    onSuccess: async () => {
      toast.success(t("danger.left"));
      await afterLeaving();
    },
    onError: (e) => handleError(e),
  });

  const transferMutation = trpc.organization.transferOwnership.useMutation({
    onSuccess: async () => {
      toast.success(t("danger.transferred"));
      await Promise.all([
        utils.organization.getById.invalidate({ id: organizationId }),
        utils.organization.listMembers.invalidate({ organizationId }),
        utils.organization.listMine.invalidate(),
        utils.organization.list.invalidate(),
        utils.organization.search.invalidate(),
      ]);
    },
    onError: (e) => handleError(e),
  });

  const members = trpc.organization.listMembers.useQuery({ organizationId }, { enabled: isOwner });

  const handleDelete = async () => {
    const ok = await confirm({
      title: t("danger.deleteTitle"),
      description: t("danger.deleteDescription"),
      confirmLabel: t("danger.deleteConfirm"),
      destructive: true,
    });
    if (!ok) return;

    deleteMutation.mutate({ id: organizationId });
  };

  const handleLeave = async () => {
    const ok = await confirm({
      title: t("danger.leaveTitle"),
      description: t("danger.leaveDescription"),
      confirmLabel: t("danger.leaveConfirm"),
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
      toast.error(t("danger.noOneToTransferTo"));
      return;
    }

    const picked = await selectOne<{ id: string; label: string }>({
      title: t("danger.transferTitle"),
      description: t("danger.transferDescription"),
      valueKey: "id",
      renderText: (m) => m.label,
      // Already loaded, so this filters in memory rather than round-tripping.
      searchFn: async (search) =>
        candidates.filter((c) => c.label.toLowerCase().includes(search.toLowerCase())),
      confirmLabel: t("danger.transferConfirm"),
    });
    if (!picked) return;

    const ok = await confirm({
      title: `Make ${picked.label.split(" · ")[0]} the owner?`,
      description: t("danger.transferWarning"),
      confirmLabel: t("danger.transferConfirmFinal"),
      destructive: true,
    });
    if (!ok) return;

    transferMutation.mutate({ organizationId, toUserId: picked.id });
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">{t("danger.title")}</CardTitle>
        <CardDescription>{t("danger.subtitle")}</CardDescription>
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
