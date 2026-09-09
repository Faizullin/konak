"use client";

import { useEnumLabels } from "@/lib/labels";
import { useTranslations } from "next-intl";
import NiceModal from "@ebay/nice-modal-react";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm-nice-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useErrorHandlers } from "@/lib/errors";
import { OrgRole } from "@/features/organizations";
import {
  canArchiveRatePlans,
  canManageRatePlans,
  MEAL_PLAN_VALUES,
  type MealPlan,
} from "@/features/rates";
import { trpc } from "@/utils/trpc";
import { RatePlanFormNiceDialog } from "./rate-plan-form-nice-dialog";

/**
 * The plans a stay can be quoted on.
 *
 * A plain `Table`: a property runs a handful of plans, and the `DataTable`
 * stack would bring URL state and pagination to a list that fits on a screen.
 */

export function RatePlansPanel({
  propertyId,
  organizationId,
  currencyCode,
}: {
  propertyId: number;
  organizationId: number;
  currencyCode: string;
}) {
  const labels = useEnumLabels("mealPlan", MEAL_PLAN_VALUES);
  const t = useTranslations("rates");
  const { handleError } = useErrorHandlers();
  const [includeArchived, setIncludeArchived] = useState(false);
  const utils = trpc.useUtils();

  const { data: organization } = trpc.organization.getById.useQuery({ id: organizationId });
  const role = (organization?.currentUserRole as OrgRole | undefined) ?? null;

  const { data, isLoading } = trpc.rate.listPlans.useQuery({ propertyId, includeArchived });
  const { data: types } = trpc.property.listRoomTypes.useQuery({
    propertyId,
    includeArchived: true,
  });

  const archive = trpc.rate.archivePlan.useMutation({
    onSuccess: (plan) => {
      toast.success(plan.archivedAt ? t("plans.archived") : t("plans.restored"));
      utils.rate.listPlans.invalidate();
    },
    onError: (error) => handleError(error),
  });

  const mayEdit = role !== null && canManageRatePlans(role);
  const mayArchive = role !== null && canArchiveRatePlans(role);

  const scope = (roomTypeId: number | null) =>
    roomTypeId === null
      ? t("plans.everyRoomType")
      : (types?.find((type) => type.id === roomTypeId)?.name ?? "—");

  const toggleArchive = async (id: number, name: string, archived: boolean) => {
    if (
      archived &&
      !(await confirm({
        title: t("plans.archiveTitle", { name }),
        description: t("plans.archiveDescription"),
        confirmLabel: t("plans.archiveConfirm"),
      }))
    ) {
      return;
    }
    archive.mutate({ propertyId, id, archived });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">{t("plans.heading")}</h2>
        <span className="text-muted-foreground text-sm">{t("plans.subtitle")}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setIncludeArchived((show) => !show)}>
            {includeArchived ? t("plans.hideArchived") : t("plans.showArchived")}
          </Button>
          {mayEdit && (
            <Button
              size="sm"
              onClick={() => NiceModal.show(RatePlanFormNiceDialog, { propertyId, currencyCode })}
            >
              <Plus />
              {t("plans.new")}
            </Button>
          )}
        </div>
      </div>

      {isLoading && !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("plans.name")}</TableHead>
              <TableHead>{t("plans.code")}</TableHead>
              <TableHead>{t("plans.appliesTo")}</TableHead>
              <TableHead>{t("plans.meals")}</TableHead>
              <TableHead>{t("plans.cancellation")}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  {t("plans.empty")}
                </TableCell>
              </TableRow>
            )}
            {(data ?? []).map((plan) => (
              <TableRow key={plan.id} className={plan.archivedAt ? "opacity-60" : undefined}>
                <TableCell className="font-medium">
                  {plan.name}
                  {plan.archivedAt && (
                    <Badge variant="outline" className="ml-2">
                      Archived
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{plan.code}</TableCell>
                <TableCell>{scope(plan.roomTypeId)}</TableCell>
                <TableCell>{labels[plan.mealPlan as MealPlan] ?? plan.mealPlan}</TableCell>
                <TableCell className="text-sm">
                  {plan.isRefundable
                    ? plan.cancellationCutoffHours === null
                      ? t("plans.freeUntilArrival")
                      : t("plans.freeUntilHours", { hours: plan.cancellationCutoffHours })
                    : t("plans.nonRefundable")}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {mayEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("plans.editLabel", { name: plan.name })}
                        onClick={() =>
                          NiceModal.show(RatePlanFormNiceDialog, {
                            propertyId,
                            currencyCode,
                            planId: plan.id,
                          })
                        }
                      >
                        <Pencil />
                      </Button>
                    )}
                    {mayArchive && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={
                          plan.archivedAt
                            ? t("plans.restoreLabel", { name: plan.name })
                            : t("plans.archiveLabel", { name: plan.name })
                        }
                        disabled={archive.isPending}
                        onClick={() => toggleArchive(plan.id, plan.name, !plan.archivedAt)}
                      >
                        {plan.archivedAt ? <ArchiveRestore /> : <Archive />}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
