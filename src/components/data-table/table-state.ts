"use client";

import type {
  ColumnFiltersState,
  PaginationState,
  SortingState,
  Updater,
} from "@tanstack/react-table";
import {
  type Parser,
  type UseQueryStateOptions,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  useQueryState,
  useQueryStates,
} from "nuqs";
import * as React from "react";

import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { getSortingStateParser } from "./parsers";
import type { ExtendedColumnSort } from "./types";

const PAGE_KEY = "page";
const PER_PAGE_KEY = "perPage";
const SORT_KEY = "sort";
const ARRAY_SEPARATOR = ",";
const DEBOUNCE_MS = 300;
const THROTTLE_MS = 50;

/** `multiple` round-trips through the URL as a comma list, `single` as a bare string. */
export type FilterArity = "single" | "multiple";

/** What `useDataTable` tells a strategy about the table it is storing state for. */
export interface DataTableStateConfig<TData> {
  columnIds: string[];
  filterKeys: Record<string, FilterArity>;
  initialPagination: PaginationState;
  initialSorting: ExtendedColumnSort<TData>[];
}

export interface DataTableStore<TData> {
  pagination: PaginationState;
  setPagination: (updater: Updater<PaginationState>) => void;
  sorting: ExtendedColumnSort<TData>[];
  setSorting: (updater: Updater<SortingState>) => void;
  columnFilters: ColumnFiltersState;
  setColumnFilters: (updater: Updater<ColumnFiltersState>) => void;
}

/**
 * Where a table keeps page, sort and filters.
 *
 * `useDataTable` calls whichever strategy it is given, always in the same
 * position, so a page picks one and keeps it — swapping between renders
 * changes the hook order and breaks React.
 */
export type DataTableStateHook = <TData>(
  config: DataTableStateConfig<TData>
) => DataTableStore<TData>;

/** An empty filter is no filter — it would otherwise light up the toolbar's Reset. */
function normalizeFilters(filters: ColumnFiltersState): ColumnFiltersState {
  return filters.filter((filter) =>
    Array.isArray(filter.value)
      ? filter.value.length > 0
      : filter.value !== "" && filter.value !== null && filter.value !== undefined
  );
}

function serializeFilters(filters: ColumnFiltersState): string {
  return JSON.stringify(
    [...filters].sort((a, b) => a.id.localeCompare(b.id)).map((filter) => [filter.id, filter.value])
  );
}

/**
 * State lives in this component. Works in dialogs, tabs, or multiple per page without URL state.
 */
export function useLocalTableState<TData>(
  config: DataTableStateConfig<TData>
): DataTableStore<TData> {
  const [pagination, setPagination] = React.useState(config.initialPagination);
  const [sorting, setSortingState] = React.useState(config.initialSorting);
  const [columnFilters, setColumnFiltersState] = React.useState<ColumnFiltersState>([]);

  const setSorting = React.useCallback((updater: Updater<SortingState>) => {
    setSortingState(
      (prev) =>
        (typeof updater === "function" ? updater(prev) : updater) as ExtendedColumnSort<TData>[]
    );
  }, []);

  const setColumnFilters = React.useCallback((updater: Updater<ColumnFiltersState>) => {
    setColumnFiltersState((prev) =>
      normalizeFilters(typeof updater === "function" ? updater(prev) : updater)
    );
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  return { pagination, setPagination, sorting, setSorting, columnFilters, setColumnFilters };
}

export interface NuqsTableStateOptions {
  /** Prefixes every key this table owns, so two URL-backed tables can share a route. */
  prefix?: string;
  history?: "push" | "replace";
  scroll?: boolean;
  shallow?: boolean;
  debounceMs?: number;
  throttleMs?: number;
  clearOnDefault?: boolean;
  startTransition?: React.TransitionStartFunction;
}

/**
 * State in the URL via nuqs. Build once at module scope to avoid hook order changes.
 */
export function nuqsTableState(options: NuqsTableStateOptions = {}): DataTableStateHook {
  const {
    prefix = "",
    history = "replace",
    scroll = false,
    shallow = true,
    debounceMs = DEBOUNCE_MS,
    throttleMs = THROTTLE_MS,
    clearOnDefault = false,
    startTransition,
  } = options;

  const pageKey = `${prefix}${PAGE_KEY}`;
  const perPageKey = `${prefix}${PER_PAGE_KEY}`;
  const sortKey = `${prefix}${SORT_KEY}`;

  return function useNuqsTableState<TData>(
    config: DataTableStateConfig<TData>
  ): DataTableStore<TData> {
    const queryStateOptions = React.useMemo<Omit<UseQueryStateOptions<string>, "parse">>(
      () => ({ history, scroll, shallow, throttleMs, debounceMs, clearOnDefault, startTransition }),
      []
    );

    const [page, setPage] = useQueryState(
      pageKey,
      parseAsInteger
        .withOptions(queryStateOptions)
        .withDefault(config.initialPagination.pageIndex + 1)
    );
    const [perPage, setPerPage] = useQueryState(
      perPageKey,
      parseAsInteger.withOptions(queryStateOptions).withDefault(config.initialPagination.pageSize)
    );

    // zero-based index in the table, one-based in the URL
    const pagination = React.useMemo<PaginationState>(
      () => ({ pageIndex: page - 1, pageSize: perPage }),
      [page, perPage]
    );

    const setPagination = React.useCallback(
      (updater: Updater<PaginationState>) => {
        const next = typeof updater === "function" ? updater(pagination) : updater;
        void setPage(next.pageIndex + 1);
        void setPerPage(next.pageSize);
      },
      [pagination, setPage, setPerPage]
    );

    const [sorting, setSortingQuery] = useQueryState(
      sortKey,
      getSortingStateParser<TData>(config.columnIds)
        .withOptions(queryStateOptions)
        .withDefault(config.initialSorting)
    );

    const setSorting = React.useCallback(
      (updater: Updater<SortingState>) => {
        const next = typeof updater === "function" ? updater(sorting) : updater;
        void setSortingQuery(next as ExtendedColumnSort<TData>[]);
      },
      [sorting, setSortingQuery]
    );

    const filterParsers = React.useMemo(
      () =>
        Object.entries(config.filterKeys).reduce<Record<string, Parser<string> | Parser<string[]>>>(
          (acc, [id, arity]) => {
            acc[`${prefix}${id}`] =
              arity === "multiple"
                ? parseAsArrayOf(parseAsString, ARRAY_SEPARATOR).withOptions(queryStateOptions)
                : parseAsString.withOptions(queryStateOptions);
            return acc;
          },
          {}
        ),
      [config.filterKeys, queryStateOptions]
    );

    const [filterValues, setFilterValues] = useQueryStates(filterParsers);

    const urlFilters = React.useMemo(
      () =>
        normalizeFilters(
          Object.keys(config.filterKeys).flatMap((id) => {
            const value = filterValues[`${prefix}${id}`];
            return value === null || value === undefined ? [] : [{ id, value }];
          })
        ),
      [config.filterKeys, filterValues]
    );

    // Keep typing responsive by holding input value locally and debouncing URL writes.
    const [columnFilters, setColumnFiltersState] = React.useState(urlFilters);
    const seenRef = React.useRef(serializeFilters(urlFilters));
    const sentRef = React.useRef<string | null>(null);

    const incoming = serializeFilters(urlFilters);
    if (incoming !== seenRef.current) {
      seenRef.current = incoming;
      // Ignore our own debounced writes so typing is not overwritten.
      if (incoming !== sentRef.current) setColumnFiltersState(urlFilters);
    }

    const pushFilters = useDebouncedCallback((record: Record<string, string | string[] | null>) => {
      void setPage(1);
      void setFilterValues(record);
    }, debounceMs);

    const setColumnFilters = React.useCallback(
      (updater: Updater<ColumnFiltersState>) => {
        const next = normalizeFilters(
          typeof updater === "function" ? updater(columnFilters) : updater
        );

        const record: Record<string, string | string[] | null> = {};
        for (const id of Object.keys(config.filterKeys)) {
          const hit = next.find((filter) => filter.id === id);
          record[`${prefix}${id}`] = hit ? (hit.value as string | string[]) : null;
        }

        sentRef.current = serializeFilters(next);
        setColumnFiltersState(next);
        pushFilters(record);
      },
      [columnFilters, config.filterKeys, pushFilters]
    );

    return { pagination, setPagination, sorting, setSorting, columnFilters, setColumnFilters };
  };
}
