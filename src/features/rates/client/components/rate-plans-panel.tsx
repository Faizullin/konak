"use client";

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
import { handleError } from "@/lib/errors";
import { OrgRole } from "@/features/organizations";
import {
  canArchiveRatePlans,
  canManageRatePlans,
  MEAL_PLAN_LABELS,
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
      toast.success(plan.archivedAt ? "Rate plan archived" : "Rate plan restored");
      utils.rate.listPlans.invalidate();
    },
    onError: (error) => handleError(error),
  });

  const mayEdit = role !== null && canManageRatePlans(role);
  const mayArchive = role !== null && canArchiveRatePlans(role);

  const scope = (roomTypeId: number | null) =>
    roomTypeId === null
      ? "Every room type"
      : (types?.find((type) => type.id === roomTypeId)?.name ?? "—");

  const toggleArchive = async (id: number, name: string, archived: boolean) => {
    if (
      archived &&
      !(await confirm({
        title: `Archive ${name}?`,
        description: "It stops being quotable. Stays already sold on it keep their terms.",
        confirmLabel: "Archive",
      }))
    ) {
      return;
    }
    archive.mutate({ propertyId, id, archived });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">Rate plans</h2>
        <span className="text-muted-foreground text-sm">
          The terms around a price. Amounts live in the calendar.
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setIncludeArchived((show) => !show)}>
            {includeArchived ? "Hide archived" : "Show archived"}
          </Button>
          {mayEdit && (
            <Button
              size="sm"
              onClick={() => NiceModal.show(RatePlanFormNiceDialog, { propertyId, currencyCode })}
            >
              <Plus />
              New plan
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
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Applies to</TableHead>
              <TableHead>Meals</TableHead>
              <TableHead>Cancellation</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No rate plans yet. A booking without one is a held room with no money attached.
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
                <TableCell>
                  {MEAL_PLAN_LABELS[plan.mealPlan as MealPlan] ?? plan.mealPlan}
                </TableCell>
                <TableCell className="text-sm">
                  {plan.isRefundable
                    ? plan.cancellationCutoffHours === null
                      ? "Free until arrival"
                      : `Free until ${plan.cancellationCutoffHours}h before`
                    : "Non-refundable"}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {mayEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${plan.name}`}
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
                          plan.archivedAt ? `Restore ${plan.name}` : `Archive ${plan.name}`
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
