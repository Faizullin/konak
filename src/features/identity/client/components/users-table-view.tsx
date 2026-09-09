"use client";

import { useEnumLabels } from "@/lib/labels";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Shield, ShieldHalf, User } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableSkeleton } from "@/components/data-table/data-table-skeleton";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { useDataTable } from "@/components/data-table/use-data-table";
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
  const [{ page, perPage, sort, name, email, role }] = useUserTableParams();

  const input = useMemo<ListUsersInput>(
    () => ({
      filter: {
        name: name ?? undefined,
        email: email ?? undefined,
        role: role ?? undefined,
      },
      orderBy: sort,
      pagination: { skip: (page - 1) * perPage, take: perPage },
    }),
    [page, perPage, sort, name, email, role]
  );

  const { data, isLoading } = trpc.user.adminList.useQuery(input, {
    // Keeps the previous page on screen while the next one loads, instead of
    // collapsing the table to a skeleton on every page change.
    placeholderData: (prev) => prev,
  });

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
              <SelectValue />
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
    [updateRole, t]
  );

  const { table } = useDataTable({
    data: data?.items ?? [],
    columns,
    pageCount: data ? Math.max(1, Math.ceil(data.total / perPage)) : 1,
    getRowId: (row) => row.id,
    initialState: { sorting: [{ id: "createdAt", desc: true }] },
  });

  if (isLoading && !data) {
    return <DataTableSkeleton columnCount={5} rowCount={5} filterCount={3} />;
  }

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}

/**
 * Reads back what `useDataTable` writes into the URL — the same arrangement
 * `OrganizationsTableView` uses, and for the same reason: the query has to run
 * before the table exists, because the row count decides `pageCount`.
 */
function useUserTableParams() {
  const searchParams = useSearchParams();

  return useMemo(() => {
    const page = Number(searchParams.get("page") ?? 1) || 1;
    const perPage = Number(searchParams.get("perPage") ?? 10) || 10;

    let sort: ListUsersInput["orderBy"];
    try {
      const raw = searchParams.get("sort");
      const parsed = raw ? (JSON.parse(raw) as { id: string; desc: boolean }[]) : [];
      const first = parsed[0];
      if (first && SORTABLE.includes(first.id)) {
        sort = {
          field: first.id as NonNullable<ListUsersInput["orderBy"]>["field"],
          direction: first.desc ? "desc" : "asc",
        };
      }
    } catch {
      // A hand-edited `?sort=` is not worth an error boundary — fall back to
      // the default ordering.
    }

    // `role` is a single value here, not the array the organizations table
    // filters by, so an unrecognised one is dropped rather than passed to a
    // schema that would reject the whole query.
    const rawRole = searchParams.get("role");
    const role = USER_ROLE_VALUES.includes(rawRole as UserRole) ? (rawRole as UserRole) : undefined;

    return [
      {
        page,
        perPage,
        sort,
        name: searchParams.get("name"),
        email: searchParams.get("email"),
        role,
      },
    ] as const;
  }, [searchParams]);
}

const SORTABLE = ["name", "email", "role", "createdAt"];
