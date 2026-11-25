'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { EmptyState } from './empty-state';
import { ErrorAlert } from './error-alert';

export interface DataTableColumn<Row> {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Applied to both the header and the cells, e.g. a width or `hidden md:table-cell`. */
  className?: string;
}

interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
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
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

/**
 * The standard table for lists of records, with loading, error and empty states built in.
 * Sorting, filtering and pagination are driven by the caller (usually via API query params).
 */
export function DataTable<Row>({
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
}: DataTableProps<Row>) {
  if (error) return <ErrorAlert error={error} onRetry={onRetry} className={className} />;

  const showSkeleton = loading && !rows;
  const isEmpty = !showSkeleton && (rows?.length ?? 0) === 0;

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
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead
                key={column.id}
                scope="col"
                className={cn(
                  'font-mono text-[11px] tracking-[0.12em] uppercase text-muted-foreground',
                  ALIGN[column.align ?? 'left'],
                  column.className,
                )}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {showSkeleton &&
            Array.from({ length: skeletonRows }, (_, i) => (
              <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                {columns.map((column) => (
                  <TableCell key={column.id} className={column.className}>
                    <Skeleton className="h-4 w-full max-w-40" />
                  </TableCell>
                ))}
              </TableRow>
            ))}

          {isEmpty && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0">
                <EmptyState title={emptyTitle} description={emptyDescription} />
              </TableCell>
            </TableRow>
          )}

          {rows?.map((row) => (
            <TableRow
              key={getRowId(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (event) => handleKeyDown(event, row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn(onRowClick && 'cursor-pointer focus-visible:bg-accent/60 focus-visible:outline-none')}
            >
              {columns.map((column) => (
                <TableCell key={column.id} className={cn(ALIGN[column.align ?? 'left'], column.className)}>
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
