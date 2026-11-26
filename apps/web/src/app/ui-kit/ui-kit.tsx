'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarIcon, EllipsisIcon, InfoIcon, PlusIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataTable, dataTableColumnHelper } from '@/components/common/data-table';
import { ErrorAlert } from '@/components/common/error-alert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { healthApi, healthKeys } from '@/lib/api/health';
import { mockOk } from '@/lib/api/mocks/helpers';
import { env } from '@/lib/env';
import { SampleForm } from './sample-form';

const SWATCHES = [
  { name: 'Green', token: 'bg-brand-green', hex: '#1E6B3E' },
  { name: 'Green deep', token: 'bg-brand-green-deep', hex: '#14432A' },
  { name: 'Sage', token: 'bg-brand-sage', hex: '#2E7D4F' },
  { name: 'Mint', token: 'bg-brand-mint', hex: '#E7F1EA' },
  { name: 'Porcelain', token: 'bg-brand-porcelain', hex: '#F7F5EE' },
  { name: 'Paper', token: 'bg-brand-paper', hex: '#FFFEFA' },
  { name: 'Ink', token: 'bg-brand-ink', hex: '#14140F' },
  { name: 'Stone', token: 'bg-brand-stone', hex: '#6E6B60' },
  { name: 'Rust', token: 'bg-brand-rust', hex: '#A6512E' },
  { name: 'Gold', token: 'bg-brand-gold', hex: '#B0893E' },
];

interface SampleBooking {
  id: string;
  client: string;
  session: string;
  /** ISO 8601, as the API sends timestamps. */
  startsAt: string;
  status: 'confirmed' | 'pending_payment' | 'cancelled' | 'completed';
}

// Fictional sample rows.
const SAMPLE_BOOKINGS: SampleBooking[] = [
  { id: 'b1', client: 'Nadia Fernandez', session: 'Follow-up session', startsAt: '2026-12-03T03:30:00Z', status: 'cancelled' },
  { id: 'b2', client: 'Amara Perera', session: 'Initial consultation', startsAt: '2026-12-02T04:30:00Z', status: 'confirmed' },
  { id: 'b3', client: 'Ravi Senanayake', session: 'Initial consultation', startsAt: '2026-12-04T08:30:00Z', status: 'completed' },
  { id: 'b4', client: 'Jonah Whitfield', session: 'Follow-up session', startsAt: '2026-12-02T06:00:00Z', status: 'pending_payment' },
];

// Clinic time, so the server render and the browser agree.
const sessionTime = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Colombo',
});

const STATUS_BADGE: Record<SampleBooking['status'], { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  confirmed: { label: 'Confirmed', variant: 'success' },
  pending_payment: { label: 'Awaiting payment', variant: 'warning' },
  cancelled: { label: 'Cancelled', variant: 'danger' },
  completed: { label: 'Completed', variant: 'neutral' },
};

const col = dataTableColumnHelper<SampleBooking>();

const BOOKING_COLUMNS = col.columns([
  col.accessor('client', {
    header: 'Client',
    sortFn: 'text',
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  col.accessor('session', { header: 'Session', sortFn: 'text', meta: { className: 'hidden sm:table-cell' } }),
  col.accessor((row) => new Date(row.startsAt), {
    id: 'when',
    header: 'When',
    sortFn: 'datetime',
    cell: (info) => sessionTime.format(info.getValue()),
  }),
  col.accessor('status', {
    header: 'Status',
    enableSorting: false,
    meta: { align: 'right' },
    cell: (info) => {
      const badge = STATUS_BADGE[info.getValue()];
      return <Badge variant={badge.variant}>{badge.label}</Badge>;
    },
  }),
]);

export function UiKit() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-10 sm:px-8">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">Developer reference</p>
        <h1 className="text-4xl">UI kit</h1>
        <p className="text-muted-foreground">
          Shared components in the Remedist styles. API mode: <code className="font-mono text-sm">{env.apiMode}</code>
        </p>
      </header>

      <ApiStatus />

      <Section title="Colours">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SWATCHES.map((swatch) => (
            <div key={swatch.name} className="overflow-hidden rounded-lg border bg-card">
              <div className={`h-14 ${swatch.token}`} />
              <div className="px-3 py-2 text-xs">
                <p className="font-semibold">{swatch.name}</p>
                <p className="font-mono text-muted-foreground">{swatch.hex}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="flex flex-col gap-3">
          <p className="eyebrow">Eyebrow label</p>
          <h1 className="text-5xl">
            Display heading <em className="font-medium text-brand-green-deep">with emphasis</em>
          </h1>
          <h2 className="text-3xl">Section heading</h2>
          <h3 className="text-2xl">Card heading</h3>
          <p className="max-w-prose">
            Body text is Manrope. It should stay comfortable to read on a phone, with enough contrast on the porcelain
            background.
          </p>
          <p className="text-sm text-muted-foreground">Secondary text in stone.</p>
          <p className="font-mono text-sm">IBM Plex Mono for codes and references: RM-2026-0142</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Saving</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="lg">
            <CalendarIcon aria-hidden="true" /> Book a session
          </Button>
          <Button size="icon" variant="outline" aria-label="Add">
            <PlusIcon aria-hidden="true" />
          </Button>
        </div>
      </Section>

      <Section title="Badges and alerts">
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="success">Confirmed</Badge>
          <Badge variant="warning">Awaiting payment</Badge>
          <Badge variant="danger">Cancelled</Badge>
          <Badge variant="neutral">Completed</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertTitle>Prices shown before login</AlertTitle>
          <AlertDescription>The final price depends on your nationality and is confirmed at checkout.</AlertDescription>
        </Alert>
        <ErrorAlert error={new Error('internal detail that must not show')} onRetry={() => toast('Retrying')} />
      </Section>

      <Section title="Form">
        <SampleForm />
      </Section>

      <Section title="Table">
        <TableDemo />
      </Section>

      <Section title="Pop-ups">
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reschedule session</DialogTitle>
                <DialogDescription>Pick a new time. Your current slot is kept until you confirm.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Keep current time</Button>
                </DialogClose>
                <Button>Continue</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open drawer</Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Amara Perera</SheetTitle>
                <SheetDescription>Client profile drawer, used across the CRM.</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-3 px-4 text-sm">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-24 w-full" />
              </div>
              <SheetFooter>
                <Button>Save changes</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <ConfirmDialog
            trigger={<Button variant="destructive">Cancel booking</Button>}
            title="Cancel this booking?"
            description="Cancelling less than 24 hours before the session counts as a late cancellation."
            confirmLabel="Cancel booking"
            cancelLabel="Keep booking"
            destructive
            onConfirm={async () => {
              await mockOk(null, 800);
              toast.success('Booking cancelled');
            }}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Booking actions">
                <EllipsisIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Booking</DropdownMenuLabel>
              <DropdownMenuItem>Reschedule</DropdownMenuItem>
              <DropdownMenuItem>Add staff note</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Mark as no-show</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost">Hover me</Button>
            </TooltipTrigger>
            <TooltipContent>Tooltips explain icons and short labels.</TooltipContent>
          </Tooltip>

          <Button variant="secondary" onClick={() => toast.success('Your booking is confirmed')}>
            Show toast
          </Button>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="upcoming" className="max-w-md">
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="text-sm text-muted-foreground">
            Your upcoming sessions.
          </TabsContent>
          <TabsContent value="past" className="text-sm text-muted-foreground">
            Your past sessions.
          </TabsContent>
        </Tabs>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby={`section-${title}`}>
      <h2 id={`section-${title}`} className="border-b pb-2 text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ApiStatus() {
  const health = useQuery({ queryKey: healthKeys.all, queryFn: ({ signal }) => healthApi.check(signal) });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-sans text-base">API connection</CardTitle>
        <CardDescription>
          {env.apiMode === 'live' ? `Calling ${env.apiOrigin}/health` : 'Mock mode: no API needed'}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {health.isPending && <Skeleton className="h-5 w-48" />}
        {health.isError && <ErrorAlert error={health.error} title="API unreachable" onRetry={() => health.refetch()} retrying={health.isFetching} />}
        {health.isSuccess && (
          <p className="flex items-center gap-2">
            <Badge variant="success">Healthy</Badge>
            Database latency {health.data.database.latencyMs} ms, up {health.data.uptimeSeconds} s
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TableDemo() {
  const [state, setState] = useState<'data' | 'loading' | 'empty' | 'error'>('data');
  const [selected, setSelected] = useState<SampleBooking | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Table state">
        {(['data', 'loading', 'empty', 'error'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={state === value ? 'default' : 'outline'}
            aria-pressed={state === value}
            onClick={() => setState(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <DataTable
        caption="Upcoming bookings"
        columns={BOOKING_COLUMNS}
        rows={state === 'data' ? SAMPLE_BOOKINGS : state === 'empty' ? [] : undefined}
        getRowId={(row) => row.id}
        loading={state === 'loading'}
        error={state === 'error' ? new Error('hidden') : undefined}
        onRetry={() => setState('data')}
        emptyTitle="No bookings yet"
        emptyDescription="New bookings will show up here."
        onRowClick={setSelected}
      />
      {selected && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Selected: {selected.client}
        </p>
      )}
    </div>
  );
}
