"use client";

import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Mail, Phone, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableSkeleton } from "@/components/data-table/data-table-skeleton";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { getFilterText } from "@/components/data-table/lib";
import { nuqsTableState } from "@/components/data-table/table-state";
import { type DataTableQueryState, useDataTable } from "@/components/data-table/use-data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PERSON_SORT_FIELDS, personDisplayName, type ListPeopleInput } from "@/features/directory";
import type { GeneralRouterOutputs } from "@/server/types";
import { useDialogControl } from "@/hooks/use-dialog-control";
import { trpc } from "@/utils/trpc";
import { PersonFormDialog } from "./person-form-dialog";
import { usePersonLink } from "@/store/surface-links";

type PersonRow = GeneralRouterOutputs["directory"]["listPeople"]["items"][number];

/**
 * The guest and contact list.
 *
 * `useDataTable` runs in manual mode, so paging, sorting and the search all
 * happen on the server — the URL is the state, and a link to a filtered view
 * reopens it.
 */
export function PeopleTableView({
  organizationId,
  orgSlug,
}: {
  organizationId: number;
  orgSlug: string;
}) {
  const t = useTranslations("directory");
  // Where a name goes is the surface's business: the dashboard keeps people in
  // its directory, the desk keeps them under the property it has open.
  const personHref = usePersonLink(orgSlug);
  // One component opens this dialog and nobody else needs to, so the state
  // lives here rather than in the NiceModal registry.
  const create = useDialogControl();

  const columns = useMemo<ColumnDef<PersonRow>[]>(
    () => [
      {
        id: "lastName",
        accessorKey: "lastName",
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("table.name")} />,
        cell: ({ row }) => (
          // The way into the person's paperwork. Without this the detail route
          // exists and nothing reaches it.
          <Link href={personHref(row.original.id)} className="font-medium hover:underline">
            {personDisplayName(row.original)}
          </Link>
        ),
        enableSorting: true,
        enableColumnFilter: true,
        meta: { label: t("table.name"), placeholder: t("table.search"), variant: "text" },
      },
      {
        id: "email",
        accessorKey: "email",
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("table.email")} />,
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
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("table.phone")} />,
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
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t("table.companies")} />
        ),
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
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("table.added")} />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
        enableSorting: true,
      },
    ],
    // `personHref` is memoised by its hook, so this is stable — and naming it
    // is what keeps it that way if the hook ever stops being.
    [t, personHref]
  );

  const { table, isLoading } = useDataTable({
    columns,
    state: peopleTableState,
    useRows: useCallback(
      // eslint-disable-next-line react-hooks/rules-of-hooks
      (queryState: DataTableQueryState<PersonRow>) => usePeopleRows(organizationId, queryState),
      [organizationId]
    ),
    getRowId: (row) => String(row.id),
    initialState: { sorting: [{ id: "lastName", desc: false }] },
  });

  if (isLoading) {
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

/** Page, sort and filters go in the URL, so a view of the list is a link. */
const peopleTableState = nuqsTableState();

/**
 * How this page fetches. `useDataTable` calls it with the state it owns and
 * reads `total` back to work out `pageCount`.
 */
function usePeopleRows(
  organizationId: number,
  { pagination, sorting, columnFilters }: DataTableQueryState<PersonRow>
) {
  const input = useMemo<ListPeopleInput>(() => {
    const sort = sorting[0];
    const field = PERSON_SORT_FIELDS.find((c) => c === sort?.id);

    return {
      organizationId,
      filter: {
        search: getFilterText(columnFilters, "lastName"),
      },
      orderBy: field && sort ? { field, direction: sort.desc ? "desc" : "asc" } : undefined,
      pagination: {
        skip: pagination.pageIndex * pagination.pageSize,
        take: pagination.pageSize,
      },
    };
  }, [organizationId, columnFilters, sorting, pagination]);

  const { data, isLoading } = trpc.directory.listPeople.useQuery(input, {
    placeholderData: (prev) => prev,
  });

  return { rows: data?.items ?? [], total: data?.total, isLoading: isLoading && !data };
}
