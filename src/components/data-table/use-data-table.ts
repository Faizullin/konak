"use client";

import {
  type ColumnFiltersState,
  type PaginationState,
  type RowSelectionState,
  type TableOptions,
  type TableState,
  type VisibilityState,
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import * as React from "react";

import {
  type DataTableStateConfig,
  type DataTableStateHook,
  type FilterArity,
  useLocalTableState,
} from "./table-state";
import type { ExtendedColumnSort } from "./types";

const DEFAULT_PAGE_SIZE = 10;

/** What the page's own fetcher is handed on every page, sort or filter change. */
export interface DataTableQueryState<TData> {
  pagination: PaginationState;
  sorting: ExtendedColumnSort<TData>[];
  columnFilters: ColumnFiltersState;
}

export interface DataTableRows<TData> {
  rows: TData[];
  /** Rows matching the filter across all pages — what `pageCount` is derived from. */
  total?: number;
  isLoading?: boolean;
}

export type DataTableRowsHook<TData> = (state: DataTableQueryState<TData>) => DataTableRows<TData>;

interface UseDataTableProps<TData> extends Omit<
  TableOptions<TData>,
  | "data"
  | "state"
  | "pageCount"
  | "getCoreRowModel"
  | "manualFiltering"
  | "manualPagination"
  | "manualSorting"
> {
  initialState?: Omit<Partial<TableState>, "sorting"> & {
    sorting?: ExtendedColumnSort<TData>[];
  };
  /** Where page, sort and filters live. Omitted: React state, scoped to this component. */
  state?: DataTableStateHook;
  /** Rows already in hand — paging, sorting and filtering then happen in the browser. */
  data?: TData[];
  rowCount?: number;
  /** The page's own fetcher. Given one, the table runs server-driven instead. */
  useRows?: DataTableRowsHook<TData>;
  manual?: boolean;
}

const EMPTY_ROWS: never[] = [];
const NO_ROWS: DataTableRows<never> = { rows: EMPTY_ROWS };

/** Holds the hook slot when a page passes `data` instead of `useRows`. Calls nothing. */
function useStaticRows(): DataTableRows<never> {
  return NO_ROWS;
}

/**
 * A TanStack table with its state kept wherever the page says.
 *
 * Two injection points, both optional and both defaulting to the plain case:
 * `state` chooses the storage (`nuqsTableState()` for the URL, otherwise React
 * state), and `useRows` is the page's own fetcher — given one, the table runs
 * in manual mode and works out `pageCount` from the `total` it returns. Pass
 * `data` instead and the browser does the paging.
 */
export function useDataTable<TData>(props: UseDataTableProps<TData>) {
  const {
    columns,
    initialState,
    state,
    data,
    rowCount,
    useRows,
    manual = Boolean(props.useRows),
    ...tableProps
  } = props;

  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>(
    initialState?.rowSelection ?? {}
  );
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    initialState?.columnVisibility ?? {}
  );

  // Initial by definition: frozen on the first render so a strategy is not fed
  // a new object every time the caller re-renders with an inline `initialState`.
  const initialRef = React.useRef({
    initialPagination: {
      pageIndex: initialState?.pagination?.pageIndex ?? 0,
      pageSize: initialState?.pagination?.pageSize ?? DEFAULT_PAGE_SIZE,
    },
    initialSorting: initialState?.sorting ?? [],
  });

  const stateConfig = React.useMemo<DataTableStateConfig<TData>>(() => {
    const filterKeys: Record<string, FilterArity> = {};

    for (const column of columns) {
      if (!column.id || !column.enableColumnFilter) continue;
      filterKeys[column.id] = column.meta?.options ? "multiple" : "single";
    }

    return {
      columnIds: columns.map((column) => column.id).filter(Boolean) as string[],
      filterKeys,
      ...initialRef.current,
    };
  }, [columns]);

  const useTableState = state ?? useLocalTableState;
  const store = useTableState(stateConfig);

  const queryState = React.useMemo<DataTableQueryState<TData>>(
    () => ({
      pagination: store.pagination,
      sorting: store.sorting,
      columnFilters: store.columnFilters,
    }),
    [store.pagination, store.sorting, store.columnFilters]
  );

  const useRowsState = useRows ?? useStaticRows;
  const fetched = useRowsState(queryState);

  const rows = useRows ? fetched.rows : (data ?? EMPTY_ROWS);
  const total = useRows ? fetched.total : rowCount;
  const isLoading = useRows ? (fetched.isLoading ?? false) : false;

  // -1 is TanStack's "unknown", which is the honest answer until the first
  // response names a total.
  const pageCount = React.useMemo(() => {
    if (!manual) return undefined;
    return total === undefined ? -1 : Math.max(1, Math.ceil(total / store.pagination.pageSize));
  }, [manual, total, store.pagination.pageSize]);

  const table = useReactTable({
    ...tableProps,
    columns,
    data: rows,
    initialState,
    pageCount,
    state: {
      pagination: store.pagination,
      sorting: store.sorting,
      columnFilters: store.columnFilters,
      columnVisibility,
      rowSelection,
    },
    defaultColumn: {
      ...tableProps.defaultColumn,
      enableColumnFilter: false,
    },
    enableRowSelection: true,
    onPaginationChange: store.setPagination,
    onSortingChange: store.setSorting,
    onColumnFiltersChange: store.setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
    manualPagination: manual,
    manualSorting: manual,
    manualFiltering: manual,
  });

  return { table, isLoading, rowCount: total };
}
