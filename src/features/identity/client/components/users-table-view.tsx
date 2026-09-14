"use client";

import { useEnumLabels } from "@/lib/labels";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Shield, ShieldHalf, User } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableSkeleton } from "@/components/data-table/data-table-skeleton";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { getFilterText } from "@/components/data-table/lib";
import { nuqsTableState } from "@/components/data-table/table-state";
import { type DataTableQueryState, useDataTable } from "@/components/data-table/use-data-table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { USER_ROLE_VALUES, UserRole, type ListUsersInput } from "@/features/identity";
import type { GeneralRouterOutputs } from "@/server/types";
import { useErrorHandlers } from "@/lib/errors";
import { trpc } from "@/utils/trpc";

type UserRow = GeneralRouterOutputs["user"]["adminList"]["items"][number];

const ROLE_ICONS: Record<UserRole, typeof User> = {
  ADMIN: Shield,
  MODERATOR: ShieldHalf,
  USER: User,
};

/**
 * The install-wide user list, as a `DataTable`.
 *
 * Reached only through `/dashboard/users`, which the sidebar shows to ADMIN
 * alone — but that is presentation. Every row here is served by
 * `user.adminList` and every edit by `user.updateRole`, both of which sit
 * behind `adminProcedure`, so the gate is the router's and this component
 * merely declines to draw a door nobody may open.
 */
export function UsersTableView() {
  const labels = useEnumLabels("userRole", USER_ROLE_VALUES);
  const t = useTranslations("identity");
  const { handleError } = useErrorHandlers();
  const utils = trpc.useUtils();

  const updateRole = trpc.user.updateRole.useMutation({
    onSuccess: async () => {
      toast.success(t("table.roleUpdated"));
      await utils.user.adminList.invalidate();
    },
    // The last-admin refusal arrives here as a BAD_REQUEST. Surfacing the
    // server's message verbatim is the whole error UI: the rule lives in one
    // place and this never has to restate it.
    onError: (e) => handleError(e),
  });

  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("table.name")} />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
        enableSorting: true,
        enableColumnFilter: true,
        enableHiding: false,
        meta: { label: t("table.name"), placeholder: t("table.searchNames"), variant: "text" },
      },
      {
        id: "email",
        accessorKey: "email",
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("table.email")} />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">{row.original.email}</span>
        ),
        enableSorting: true,
        enableColumnFilter: true,
        meta: { label: t("table.email"), placeholder: t("table.searchEmails"), variant: "text" },
      },
      {
        id: "role",
        accessorKey: "role",
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("table.role")} />,
        cell: ({ row }) => (
          <Select
            value={row.original.role}
            onValueChange={(v) => updateRole.mutate({ id: row.original.id, role: v as UserRole })}
          >
            <SelectTrigger className="w-36" size="sm">
              <SelectValue>{(v: UserRole) => labels[v] ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {USER_ROLE_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {labels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
        enableSorting: true,
        enableColumnFilter: true,
        meta: {
          label: t("table.role"),
          variant: "select",
          options: USER_ROLE_VALUES.map((value) => ({
            label: labels[value],
            value,
            icon: ROLE_ICONS[value] as React.FC<React.SVGProps<SVGSVGElement>>,
          })),
        },
      },
      {
        id: "emailVerified",
        accessorKey: "emailVerified",
        header: t("table.verified"),
        cell: ({ row }) => (
          <Badge variant={row.original.emailVerified ? "secondary" : "outline"}>
            {row.original.emailVerified ? t("table.verified") : t("table.pending")}
          </Badge>
        ),
        enableSorting: false,
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("table.joined")} />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
        enableSorting: true,
      },
    ],
    [labels, updateRole, t]
  );

  const { table, isLoading } = useDataTable({
    columns,
    state: userTableState,
    useRows: useUserRows,
    getRowId: (row) => row.id,
    initialState: { sorting: [{ id: "createdAt", desc: true }] },
  });

  if (isLoading) {
    return <DataTableSkeleton columnCount={5} rowCount={5} filterCount={3} />;
  }

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}

const USER_SORT_FIELDS = ["name", "email", "role", "createdAt"] as const;

/** Page, sort and filters go in the URL, so a view of the list is a link. */
const userTableState = nuqsTableState();

/**
 * How this page fetches. `useDataTable` calls it with the state it owns and
 * reads `total` back to work out `pageCount`.
 */
function useUserRows({ pagination, sorting, columnFilters }: DataTableQueryState<UserRow>) {
  const input = useMemo<ListUsersInput>(() => {
    const sort = sorting[0];
    const field = USER_SORT_FIELDS.find((candidate) => candidate === sort?.id);

    // `role` is one value here, not the list the organizations table filters
    // by, so an unrecognised one is dropped rather than passed to a schema
    // that would reject the whole query.
    const role = getFilterText(columnFilters, "role");

    return {
      filter: {
        name: getFilterText(columnFilters, "name"),
        email: getFilterText(columnFilters, "email"),
        role: USER_ROLE_VALUES.includes(role as UserRole) ? (role as UserRole) : undefined,
      },
      orderBy: field && sort ? { field, direction: sort.desc ? "desc" : "asc" } : undefined,
      pagination: {
        skip: pagination.pageIndex * pagination.pageSize,
        take: pagination.pageSize,
      },
    };
  }, [pagination, sorting, columnFilters]);

  const { data, isLoading } = trpc.user.adminList.useQuery(input, {
    // Keeps the previous page on screen while the next one loads, instead of
    // collapsing the table to a skeleton on every page change.
    placeholderData: (prev) => prev,
  });

  return { rows: data?.items ?? [], total: data?.total, isLoading: isLoading && !data };
}
