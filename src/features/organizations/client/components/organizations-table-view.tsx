"use client";

import NiceModal from "@ebay/nice-modal-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, MoreHorizontal, Pencil, Settings, Shield, User, Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableSkeleton } from "@/components/data-table/data-table-skeleton";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { useDataTable } from "@/components/data-table/use-data-table";
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
  ORG_ROLE_LABELS,
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
 * happen here rather than in the browser. It queries `OrganizationMember`
 * rather than `Organization` because the caller's own role is both a column
 * and a filter — reading it from the membership row means one query instead
 * of a list plus a per-row lookup.
 */
export function OrganizationsTableView() {
  const [{ page, perPage, sort, name, slug, role }] = useOrganizationTableParams();

  const input = useMemo<ListOrganizationsInput>(
    () => ({
      filter: {
        name: name ?? undefined,
        slug: slug ?? undefined,
        role: role?.length ? (role as OrgRole[]) : undefined,
      },
      orderBy: sort,
      pagination: { skip: (page - 1) * perPage, take: perPage },
    }),
    [page, perPage, sort, name, slug, role]
  );

  const { data, isLoading } = trpc.organization.list.useQuery(input, {
    // Keeps the previous page on screen while the next one loads, instead of
    // collapsing the table to a skeleton on every page change.
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<OrganizationRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Organization" />,
        cell: ({ row }) => (
          <Link
            href={`/dashboard/orgs/${row.original.id}`}
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
              {ORG_ROLE_LABELS[role]}
            </Badge>
          );
        },
        enableSorting: false,
        enableColumnFilter: true,
        meta: {
          label: "Your role",
          variant: "multiSelect",
          options: Object.values(OrgRole).map((role) => ({
            label: ORG_ROLE_LABELS[role],
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
                  <DropdownMenuItem render={<Link href={`/dashboard/orgs/${org.id}`} />}>
                    Open
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link href={`/dashboard/orgs/${org.id}/members`} />}>
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
    []
  );

  const { table } = useDataTable({
    data: data?.items ?? [],
    columns,
    pageCount: data ? Math.max(1, Math.ceil(data.total / perPage)) : 1,
    getRowId: (row) => String(row.id),
    initialState: { sorting: [{ id: "name", desc: false }] },
  });

  if (isLoading && !data) {
    return <DataTableSkeleton columnCount={6} rowCount={5} filterCount={3} />;
  }

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}

/**
 * Reads back what `useDataTable` writes into the URL.
 *
 * The hook owns those keys but does not hand them out in a shape a query can
 * use, and the query has to run *before* the table is built — the row count
 * decides `pageCount`. Parsing the same search params is the smaller evil
 * compared with a second source of truth.
 */
function useOrganizationTableParams() {
  const searchParams = useSearchParams();

  return useMemo(() => {
    const page = Number(searchParams.get("page") ?? 1) || 1;
    const perPage = Number(searchParams.get("perPage") ?? 10) || 10;

    let sort: ListOrganizationsInput["orderBy"];
    try {
      const raw = searchParams.get("sort");
      const parsed = raw ? (JSON.parse(raw) as { id: string; desc: boolean }[]) : [];
      const first = parsed[0];
      if (first && SORTABLE.includes(first.id)) {
        sort = {
          field: first.id as "name" | "slug" | "createdAt",
          direction: first.desc ? "desc" : "asc",
        };
      }
    } catch {
      // A hand-edited `?sort=` is not worth an error boundary — fall back to
      // the default ordering.
    }

    return [
      {
        page,
        perPage,
        sort,
        name: searchParams.get("name"),
        slug: searchParams.get("slug"),
        role: searchParams.get("currentUserRole")?.split(",").filter(Boolean),
      },
    ] as const;
  }, [searchParams]);
}

const SORTABLE = ["name", "slug", "createdAt"];
