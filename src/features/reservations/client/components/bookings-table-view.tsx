"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
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
  BOOKING_VIEW_VALUES,
  BookingView,
  RESERVATION_SORT_FIELDS,
  RESERVATION_STATUS_VALUES,
  ReservationStatus,
  type ListReservationsInput,
} from "@/features/reservations";
import { useEnumLabels } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import type { GeneralRouterOutputs } from "@/server/types";
import { useSurfaceLinks } from "@/store/surface-links";
import { trpc } from "@/utils/trpc";

type BookingRow = GeneralRouterOutputs["reservation"]["list"]["items"][number];

/**
 * Bookings as a list, beside the grid rather than inside it.
 *
 * The grid answers "what is happening on these nights" and is bounded by a
 * window; this answers "where is the booking for the person on the phone",
 * which has no dates in it at all. Both open the same card, because a
 * reservation has one screen.
 */
export function BookingsTableView({
  propertyId,
  orgSlug,
  propertySlug,
}: {
  propertyId: number;
  orgSlug: string;
  propertySlug: string;
}) {
  const t = useTranslations("reservations");
  const locale = useLocale();
  const statusLabels = useEnumLabels("reservationStatus", RESERVATION_STATUS_VALUES);
  const viewLabels = useEnumLabels("bookingView", BOOKING_VIEW_VALUES);
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawView = searchParams.get("view");
  const view = BOOKING_VIEW_VALUES.includes(rawView as BookingView)
    ? (rawView as BookingView)
    : BookingView.CURRENT;

  // Where a row goes is the surface's business, not this table's.
  const links = useSurfaceLinks({ orgSlug, propertySlug });

  const dates = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }),
    [locale]
  );

  /** A tab is part of the view, so it belongs in the URL with the rest of it. */
  const openView = (next: BookingView) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    // The old page number means nothing in a different set of rows.
    params.delete("page");
    router.replace(`${links.bookings()}?${params.toString()}`);
  };

  const columns = useMemo<ColumnDef<BookingRow>[]>(
    () => [
      {
        id: "guestName",
        accessorKey: "guestName",
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("list.guest")} />,
        cell: ({ row }) => (
          <Link href={links.booking(row.original.publicId)} className="font-medium hover:underline">
            {row.original.guestName ?? row.original.reference}
          </Link>
        ),
        enableSorting: false,
        enableColumnFilter: true,
        enableHiding: false,
        // One box for three things: the desk knows a name, a room or a
        // reference, and which of the three is not its problem.
        meta: { label: t("list.find"), placeholder: t("list.findPlaceholder"), variant: "text" },
      },
      {
        id: "reference",
        accessorKey: "reference",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t("list.reference")} />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono text-xs">{row.original.reference}</span>
        ),
        enableSorting: true,
      },
      {
        id: "status",
        accessorKey: "status",
        header: t("list.status"),
        cell: ({ row }) => (
          <Badge variant="outline">
            {statusLabels[row.original.status as ReservationStatus] ?? row.original.status}
          </Badge>
        ),
        enableSorting: false,
        enableColumnFilter: true,
        meta: {
          label: t("list.status"),
          variant: "multiSelect",
          options: RESERVATION_STATUS_VALUES.map((value) => ({
            label: statusLabels[value] ?? value,
            value,
          })),
        },
      },
      {
        id: "dates",
        header: t("list.dates"),
        cell: ({ row }) => {
          const { checkIn, checkOut, nights } = row.original;
          if (!checkIn || !checkOut) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="whitespace-nowrap">
              {dates.format(checkIn)} → {dates.format(checkOut)}{" "}
              <span className="text-muted-foreground text-xs">
                {t("list.nightCount", { nights })}
              </span>
            </span>
          );
        },
        enableSorting: false,
      },
      {
        id: "rooms",
        header: t("list.rooms"),
        cell: ({ row }) => {
          // A booking with no door yet is the ordinary case for a future
          // date, so the type is what it is named by until one is chosen.
          const { rooms, roomTypes } = row.original;
          return (
            <span className="text-sm">
              {rooms.length > 0 ? (
                rooms.join(", ")
              ) : (
                <span className="text-muted-foreground italic">{roomTypes.join(", ")}</span>
              )}
            </span>
          );
        },
        enableSorting: false,
      },
      {
        id: "totalMinor",
        accessorKey: "totalMinor",
        header: t("list.total"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatMoney(row.original.totalMinor, row.original.currencyCode, locale)}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: "bookedAt",
        accessorKey: "bookedAt",
        header: ({ column }) => <DataTableColumnHeader column={column} title={t("list.booked")} />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs whitespace-nowrap">
            {dates.format(row.original.bookedAt)}
          </span>
        ),
        enableSorting: true,
      },
    ],
    [t, statusLabels, dates, locale, links]
  );

  const { table, isLoading } = useDataTable({
    columns,
    state: bookingTableState,
    useRows: useCallback(
      // eslint-disable-next-line react-hooks/rules-of-hooks
      (queryState: DataTableQueryState<BookingRow>) => useBookingRows(propertyId, queryState),
      [propertyId]
    ),
    getRowId: (row) => row.publicId,
    initialState: { sorting: [{ id: "bookedAt", desc: true }] },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {BOOKING_VIEW_VALUES.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={value === view ? "default" : "outline"}
            onClick={() => openView(value)}
          >
            {viewLabels[value] ?? value}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <DataTableSkeleton columnCount={7} rowCount={5} filterCount={2} />
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}
    </div>
  );
}

/** Page, sort and filters go in the URL, so a view of the list is a link. */
const bookingTableState = nuqsTableState();

/**
 * How this page fetches. `useDataTable` calls it with the state it owns and
 * reads `total` back to work out `pageCount`.
 */
function useBookingRows(
  propertyId: number,
  { pagination, sorting, columnFilters }: DataTableQueryState<BookingRow>
) {
  const searchParams = useSearchParams();
  const rawView = searchParams.get("view");
  const view = BOOKING_VIEW_VALUES.includes(rawView as BookingView)
    ? (rawView as BookingView)
    : BookingView.CURRENT;

  const input = useMemo<ListReservationsInput>(() => {
    const sort = sorting[0];
    const field = RESERVATION_SORT_FIELDS.find((candidate) => candidate === sort?.id);

    return {
      propertyId,
      filter: {
        search: getFilterText(columnFilters, "guestName"),
        view,
        status: getFilterList(columnFilters, "status") as ReservationStatus[] | undefined,
      },
      orderBy: field && sort ? { field, direction: sort.desc ? "desc" : "asc" } : undefined,
      pagination: {
        skip: pagination.pageIndex * pagination.pageSize,
        take: pagination.pageSize,
      },
    };
  }, [propertyId, columnFilters, view, sorting, pagination]);

  const { data, isLoading } = trpc.reservation.list.useQuery(input, {
    placeholderData: (prev) => prev,
  });

  return { rows: data?.items ?? [], total: data?.total, isLoading: isLoading && !data };
}
