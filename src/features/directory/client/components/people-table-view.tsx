"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Mail, Phone, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableSkeleton } from "@/components/data-table/data-table-skeleton";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { useDataTable } from "@/components/data-table/use-data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { personDisplayName, type ListPeopleInput } from "@/features/directory";
import type { GeneralRouterOutputs } from "@/server/types";
import { useDialogControl } from "@/hooks/use-dialog-control";
import { trpc } from "@/utils/trpc";
import { PersonFormDialog } from "./person-form-dialog";

type PersonRow = GeneralRouterOutputs["directory"]["listPeople"]["items"][number];

const SORTABLE = ["lastName", "firstName", "createdAt"];

/**
 * The guest and contact list.
 *
 * `useDataTable` runs in manual mode, so paging, sorting and the search all
 * happen on the server — the URL is the state, and a link to a filtered view
 * reopens it.
 */
export function PeopleTableView({ organizationId }: { organizationId: number }) {
  const [{ page, perPage, sort, search }] = usePeopleTableParams();
  // One component opens this dialog and nobody else needs to, so the state
  // lives here rather than in the NiceModal registry.
  const create = useDialogControl();

  const input = useMemo<ListPeopleInput>(
    () => ({
      organizationId,
      filter: { search: search ?? undefined },
      orderBy: sort,
      pagination: { skip: (page - 1) * perPage, take: perPage },
    }),
    [organizationId, page, perPage, sort, search]
  );

  const { data, isLoading } = trpc.directory.listPeople.useQuery(input, {
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<PersonRow>[]>(
    () => [
      {
        id: "lastName",
        accessorKey: "lastName",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="font-medium">{personDisplayName(row.original)}</span>,
        enableSorting: true,
        enableColumnFilter: true,
        meta: { label: "Name", placeholder: "Search name or email…", variant: "text" },
      },
      {
        id: "email",
        accessorKey: "email",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
        cell: ({ row }) =>
          row.original.email ? (
            <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Mail className="size-3.5" />
              {row.original.email}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
      {
        id: "phone",
        accessorKey: "phone",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Phone" />,
        cell: ({ row }) =>
          row.original.phone ? (
            <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Phone className="size-3.5" />
              {row.original.phone}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
      {
        id: "companies",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Companies" />,
        cell: ({ row }) => {
          const links = row.original.companies;
          if (links.length === 0) return <span className="text-muted-foreground text-sm">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {links.map((link) => (
                <Badge key={link.id} variant="secondary" className="gap-1">
                  <Building2 className="size-3" />
                  {link.company.name}
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Added" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
        enableSorting: true,
      },
    ],
    []
  );

  const { table } = useDataTable({
    data: data?.items ?? [],
    columns,
    pageCount: data ? Math.max(1, Math.ceil(data.total / perPage)) : 1,
    getRowId: (row) => String(row.id),
    initialState: { sorting: [{ id: "lastName", desc: false }] },
  });

  if (isLoading && !data) {
    return <DataTableSkeleton columnCount={5} rowCount={5} filterCount={1} />;
  }

  return (
    <>
      <DataTable table={table}>
        <DataTableToolbar table={table}>
          <Button size="sm" onClick={() => create.show()}>
            <Plus className="size-4" />
            New person
          </Button>
        </DataTableToolbar>
      </DataTable>

      <PersonFormDialog
        organizationId={organizationId}
        open={create.isVisible}
        onOpenChange={(open) => !open && create.hide()}
      />
    </>
  );
}

/**
 * A second reader of one source of truth, not a second source of truth. A
 * hand-edited `?sort=` falls back to the default ordering rather than throwing.
 */
function usePeopleTableParams() {
  const searchParams = useSearchParams();

  return useMemo(() => {
    const page = Number(searchParams.get("page") ?? 1) || 1;
    const perPage = Number(searchParams.get("perPage") ?? 10) || 10;

    let sort: ListPeopleInput["orderBy"];
    try {
      const raw = searchParams.get("sort");
      const parsed = raw ? (JSON.parse(raw) as { id: string; desc: boolean }[]) : [];
      const first = parsed[0];
      if (first && SORTABLE.includes(first.id)) {
        sort = {
          field: first.id as "lastName" | "firstName" | "createdAt",
          direction: first.desc ? "desc" : "asc",
        };
      }
    } catch {
      // Not worth an error boundary.
    }

    return [{ page, perPage, sort, search: searchParams.get("lastName") }] as const;
  }, [searchParams]);
}
