'use client';

import {
  createColumnHelper,
  createSortedRowModel,
  metaHelper,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type OnChangeFn,
  type RowData,
  type SortingState,
  type TableOptions,
} from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { EmptyState } from './empty-state';
import { ErrorAlert } from './error-alert';

// TanStack Table v9 registers features explicitly. Defined once at module scope so the
// table's models stay stable across renders. Add features here (pagination, row selection...)
// as screens need them.

export interface DataTableColumnMeta {
  align?: 'left' | 'right' | 'center';
  /** Applied to the header and every cell, e.g. a width or `hidden md:table-cell`. */
  className?: string;
}

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, datetime: sortFn_datetime },
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumns<Row extends RowData> = TableOptions<DataTableFeatures, Row>['columns'];

/**
 * Column helper bound to the DataTable features. Define columns at module scope:
 *
 *   const col = dataTableColumnHelper<Booking>();
 *   const columns = col.columns([
 *     col.accessor('clientName', { header: 'Client' }),
 *     col.accessor('startsAt', { header: 'When', sortFn: 'datetime', cell: (c) => formatDate(c.getValue()) }),
 *   ]);
 */
export function dataTableColumnHelper<Row extends RowData>() {
  return createColumnHelper<DataTableFeatures, Row>();
}

interface DataTableProps<Row extends RowData> {
  columns: DataTableColumns<Row>;
  rows: Row[] | undefined;
  getRowId: (row: Row) => string;
  /** Accessible name for the table. */
  caption: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Makes rows clickable and keyboard-activatable (Enter or Space), e.g. to open a drawer. */
  onRowClick?: (row: Row) => void;
  skeletonRows?: number;
  className?: string;
  /**
   * Sorting. Leave all three out for client-side sorting of the given rows.
   * For lists the API sorts (paged lists), pass `sorting` + `onSortingChange` + `manualSorting`,
   * and put `sorting` in the query key so a new sort fetches a new page.
   */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  manualSorting?: boolean;
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;
const JUSTIFY = { left: 'justify-start', right: 'justify-end', center: 'justify-center' } as const;

// Stable fallback: a new [] each render would rebuild the row models every time.
const NO_ROWS: never[] = [];

/** The standard table for lists of records, with sorting and loading, error and empty states built in. */
export function DataTable<Row extends RowData>({
  columns,
  rows,
  getRowId,
  caption,
  loading = false,
  error,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  onRowClick,
  skeletonRows = 5,
  className,
  sorting,
  onSortingChange,
  manualSorting = false,
}: DataTableProps<Row>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows ?? NO_ROWS,
    getRowId: (row: Row) => getRowId(row),
    manualSorting,
    // Always ascending first (A→Z, soonest first). TanStack otherwise starts dates and numbers descending.
    // A column can still set its own `sortDescFirst`.
    sortDescFirst: false,
    ...(sorting !== undefined ? { state: { sorting }, onSortingChange } : {}),
  });

  if (error) return <ErrorAlert error={error} onRetry={onRetry} className={className} />;

  const visibleRows = table.getRowModel().rows;
  const columnCount = table.getAllLeafColumns().length;
  const showSkeleton = loading && !rows;
  const isEmpty = !showSkeleton && visibleRows.length === 0;

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: Row) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick?.(row);
    }
  }

  return (
    <div className={cn('rounded-lg border bg-card', className)} aria-busy={loading || undefined}>
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                const align = meta?.align ?? 'left';
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const label = header.isPlaceholder ? null : <table.FlexRender header={header} />;

                return (
                  <TableHead
                    key={header.id}
                    scope="col"
                    aria-sort={canSort ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : undefined}
                    className={cn(
                      'font-mono text-[11px] tracking-[0.12em] uppercase text-muted-foreground',
                      ALIGN[align],
                      meta?.className,
                    )}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          '-mx-1.5 inline-flex w-[calc(100%+0.75rem)] items-center gap-1 rounded-sm px-1.5 py-1 uppercase hover:text-foreground',
                          JUSTIFY[align],
                          sorted && 'text-foreground',
                        )}
                      >
                        {label}
                        <SortIcon sorted={sorted} />
                      </button>
                    ) : (
                      label
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {showSkeleton &&
            Array.from({ length: skeletonRows }, (_, i) => (
              <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                {table.getAllLeafColumns().map((column) => (
                  <TableCell key={column.id} className={column.columnDef.meta?.className}>
                    <Skeleton className="h-4 w-full max-w-40" />
                  </TableCell>
                ))}
              </TableRow>
            ))}

          {isEmpty && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columnCount} className="p-0">
                <EmptyState title={emptyTitle} description={emptyDescription} />
              </TableCell>
            </TableRow>
          )}

          {!showSkeleton &&
            visibleRows.map((row) => (
              <TableRow
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={onRowClick ? (event) => handleKeyDown(event, row.original) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(onRowClick && 'cursor-pointer focus-visible:bg-accent/60 focus-visible:outline-none')}
              >
                {row.getAllCells().map((cell) => {
                  const meta = cell.column.columnDef.meta;
                  return (
                    <TableCell key={cell.id} className={cn(ALIGN[meta?.align ?? 'left'], meta?.className)}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SortIcon({ sorted }: { sorted: false | 'asc' | 'desc' }) {
  const Icon = sorted === 'asc' ? ArrowUpIcon : sorted === 'desc' ? ArrowDownIcon : ChevronsUpDownIcon;
  return <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', !sorted && 'opacity-50')} />;
}
