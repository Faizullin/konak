"use client";

import { useEnumLabels } from "@/lib/labels";
import NiceModal from "@ebay/nice-modal-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, MoreHorizontal, Pencil, Settings, Shield, User, Users } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableSkeleton } from "@/components/data-table/data-table-skeleton";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { getFilterList, getFilterText } from "@/components/data-table/lib";
import { nuqsTableState } from "@/components/data-table/table-state";
import { type DataTableQueryState, useDataTable } from "@/components/data-table/use-data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ORGANIZATION_SORT_FIELDS,
  ORG_ROLE_VALUES,
  OrgRole,
  canEditOrganization,
  type ListOrganizationsInput,
} from "@/features/organizations";
import type { GeneralRouterOutputs } from "@/server/types";
import { trpc } from "@/utils/trpc";
import { OrganizationFormNiceDialog } from "./organization-form-nice-dialog";

type OrganizationRow = GeneralRouterOutputs["organization"]["list"]["items"][number];

const ROLE_ICONS: Record<OrgRole, typeof User> = {
  OWNER: Shield,
  ADMIN: Settings,
  MEMBER: User,
};

const ROLE_BADGE: Record<OrgRole, "default" | "secondary" | "outline"> = {
  OWNER: "default",
  ADMIN: "secondary",
  MEMBER: "outline",
};

/**
 * The organizations list, as a `DataTable`.
 *
 * `useDataTable` runs in manual mode, so paging, sorting and filtering all
 * happen here rather than in the browser.
 */
export function OrganizationsTableView() {
  const labels = useEnumLabels("orgRole", ORG_ROLE_VALUES);

  const columns = useMemo<ColumnDef<OrganizationRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Organization" />,
        cell: ({ row }) => (
          <Link
            href={`/dashboard/orgs/${row.original.slug}`}
            className="flex items-center gap-2 font-medium hover:underline"
          >
            <div className="bg-primary/10 flex size-8 items-center justify-center rounded-md">
              <Building2 className="size-4" />
            </div>
            <span className="truncate">{row.original.name}</span>
          </Link>
        ),
        enableSorting: true,
        enableColumnFilter: true,
        enableHiding: false,
        meta: { label: "Organization", placeholder: "Search names…", variant: "text" },
      },
      {
        id: "slug",
        accessorKey: "slug",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Slug" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono text-xs">/{row.original.slug}</span>
        ),
        enableSorting: true,
        enableColumnFilter: true,
        meta: { label: "Slug", placeholder: "Search slugs…", variant: "text" },
      },
      {
        id: "currentUserRole",
        accessorKey: "currentUserRole",
        header: "Your role",
        cell: ({ row }) => {
          const role = row.original.currentUserRole;
          const Icon = ROLE_ICONS[role];
          return (
            <Badge variant={ROLE_BADGE[role]}>
              <Icon className="mr-1 size-3" />
              {labels[role]}
            </Badge>
          );
        },
        enableSorting: false,
        enableColumnFilter: true,
        meta: {
          label: "Your role",
          variant: "multiSelect",
          options: Object.values(OrgRole).map((role) => ({
            label: labels[role],
            value: role,
            icon: ROLE_ICONS[role] as React.FC<React.SVGProps<SVGSVGElement>>,
          })),
        },
      },
      {
        id: "memberCount",
        accessorKey: "memberCount",
        header: "Members",
        cell: ({ row }) => (
          <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Users className="size-4" />
            {row.original.memberCount}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
        enableSorting: true,
      },
      {
        id: "actions",
        cell: ({ row }) => {
          const org = row.original;
          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="sm" className="size-8 p-0" />}
                >
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">Actions for {org.name}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {/* Base UI's GroupLabel reads MenuGroupContext — a label
                      outside a Group throws. Radix had no such requirement. */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{org.name}</DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem render={<Link href={`/dashboard/orgs/${org.slug}`} />}>
                    Open
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link href={`/dashboard/orgs/${org.slug}/members`} />}>
                    Members
                  </DropdownMenuItem>
                  {canEditOrganization(org.currentUserRole) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() =>
                          NiceModal.show(OrganizationFormNiceDialog, {
                            mode: "edit",
                            organizationId: org.id,
                          })
                        }
                      >
                        <Pencil className="size-4" />
                        Edit
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [labels]
  );

  const { table, isLoading } = useDataTable({
    columns,
    state: organizationTableState,
    useRows: useOrganizationRows,
    getRowId: (row) => String(row.id),
    initialState: { sorting: [{ id: "name", desc: false }] },
  });

  if (isLoading) {
    return <DataTableSkeleton columnCount={6} rowCount={5} filterCount={3} />;
  }

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}

/** Page, sort and filters go in the URL, so a view of the list is a link. */
const organizationTableState = nuqsTableState();

/**
 * How this page fetches. `useDataTable` calls it with the state it owns and
 * reads `total` back to work out `pageCount`.
 */
function useOrganizationRows({
  pagination,
  sorting,
  columnFilters,
}: DataTableQueryState<OrganizationRow>) {
  const input = useMemo<ListOrganizationsInput>(() => {
    const sort = sorting[0];
    const field = ORGANIZATION_SORT_FIELDS.find((candidate) => candidate === sort?.id);

    return {
      filter: {
        name: getFilterText(columnFilters, "name"),
        slug: getFilterText(columnFilters, "slug"),
        role: getFilterList(columnFilters, "currentUserRole") as OrgRole[] | undefined,
      },
      orderBy: field && sort ? { field, direction: sort.desc ? "desc" : "asc" } : undefined,
      pagination: {
        skip: pagination.pageIndex * pagination.pageSize,
        take: pagination.pageSize,
      },
    };
  }, [pagination, sorting, columnFilters]);

  const { data, isLoading } = trpc.organization.list.useQuery(input, {
    // Keeps the previous page on screen while the next one loads, instead of
    // collapsing the table to a skeleton on every page change.
    placeholderData: (prev) => prev,
  });

  return { rows: data?.items ?? [], total: data?.total, isLoading: isLoading && !data };
}
