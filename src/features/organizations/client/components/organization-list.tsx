"use client";

import NiceModal from "@ebay/nice-modal-react";
import { Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/utils/trpc";
import { OrganizationFormNiceDialog } from "./organization-form-nice-dialog";
import { OrganizationsTableView } from "./organizations-table-view";

/**
 * The organizations screen: an empty state, or the table.
 *
 * The split needs its own query. `list` returning nothing means
 * "nothing matched" — which is not the same as "you have no organizations",
 * and showing "create your first" to someone who has filtered themselves into
 * an empty page is how people conclude their data is gone. `listMine` answers the
 * second question; it is already cached by the sidebar switcher.
 */
export function OrganizationList() {
  const { data, isLoading } = trpc.organization.listMine.useQuery(undefined, {
    staleTime: 60_000,
  });

  const openCreate = () => NiceModal.show(OrganizationFormNiceDialog, { mode: "create" });

  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  if (!data?.length) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Building2 className="text-muted-foreground size-8" />
          <div>
            <p className="font-medium">No organizations yet</p>
            <p className="text-muted-foreground text-sm">
              Create one to start inviting people and grouping work.
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            New organization
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          New organization
        </Button>
      </div>
      <OrganizationsTableView />
    </div>
  );
}
