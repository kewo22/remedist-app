'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarIcon, EllipsisIcon, InfoIcon, PlusIcon } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/common/data-table';
import { ErrorAlert } from '@/components/common/error-alert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getErrorMessage, getFieldErrors, type FieldErrors } from '@/lib/api/errors';
import { healthApi, healthKeys } from '@/lib/api/health';
import { mockFail, mockOk } from '@/lib/api/mocks/helpers';
import { env } from '@/lib/env';

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
  when: string;
  status: 'confirmed' | 'pending_payment' | 'cancelled' | 'completed';
}

// Fictional sample rows.
const SAMPLE_BOOKINGS: SampleBooking[] = [
  { id: 'b1', client: 'Amara Perera', session: 'Initial consultation', when: 'Mon 2 Dec, 10:00', status: 'confirmed' },
  { id: 'b2', client: 'Jonah Whitfield', session: 'Follow-up session', when: 'Mon 2 Dec, 11:30', status: 'pending_payment' },
  { id: 'b3', client: 'Nadia Fernandez', session: 'Follow-up session', when: 'Tue 3 Dec, 09:00', status: 'cancelled' },
  { id: 'b4', client: 'Ravi Senanayake', session: 'Initial consultation', when: 'Wed 4 Dec, 14:00', status: 'completed' },
];

const STATUS_BADGE: Record<SampleBooking['status'], { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  confirmed: { label: 'Confirmed', variant: 'success' },
  pending_payment: { label: 'Awaiting payment', variant: 'warning' },
  cancelled: { label: 'Cancelled', variant: 'danger' },
  completed: { label: 'Completed', variant: 'neutral' },
};

const BOOKING_COLUMNS: DataTableColumn<SampleBooking>[] = [
  { id: 'client', header: 'Client', cell: (row) => <span className="font-medium">{row.client}</span> },
  { id: 'session', header: 'Session', cell: (row) => row.session, className: 'hidden sm:table-cell' },
  { id: 'when', header: 'When', cell: (row) => row.when },
  {
    id: 'status',
    header: 'Status',
    align: 'right',
    cell: (row) => <Badge variant={STATUS_BADGE[row.status].variant}>{STATUS_BADGE[row.status].label}</Badge>,
  },
];

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

function SampleForm() {
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Simulates the API rejecting the form, to show how VALIDATION_FAILED maps onto fields.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await mockFail(400, 'VALIDATION_FAILED', 'Please check the highlighted fields.', [
        { field: 'email', messages: ['Enter a valid email address.'] },
        { field: 'phone', messages: ['Enter the number with its country code, e.g. +94 77 123 4567.'] },
      ]);
    } catch (error) {
      setFieldErrors(getFieldErrors(error));
      setFormError(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  const errorsFor = (field: string) => fieldErrors[field]?.map((message) => ({ message }));

  return (
    <Card className="max-w-xl">
      <CardContent>
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(fieldErrors.name) || undefined}>
              <FieldLabel htmlFor="name">Full name</FieldLabel>
              <Input id="name" name="name" autoComplete="name" />
            </Field>
            <Field data-invalid={Boolean(fieldErrors.email) || undefined}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(fieldErrors.email) || undefined}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              />
              <FieldError id="email-error" errors={errorsFor('email')} />
            </Field>
            <Field data-invalid={Boolean(fieldErrors.phone) || undefined}>
              <FieldLabel htmlFor="phone">WhatsApp number</FieldLabel>
              <Input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                aria-invalid={Boolean(fieldErrors.phone) || undefined}
                aria-describedby={fieldErrors.phone ? 'phone-hint phone-error' : 'phone-hint'}
              />
              <FieldDescription id="phone-hint">We send reminders here.</FieldDescription>
              <FieldError id="phone-error" errors={errorsFor('phone')} />
            </Field>
            <Field>
              <FieldLabel htmlFor="session-type">Session type</FieldLabel>
              <Select name="sessionType">
                <SelectTrigger id="session-type" className="w-full">
                  <SelectValue placeholder="Choose a session" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="initial">Initial consultation</SelectItem>
                  <SelectItem value="follow-up">Follow-up session</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel id="payment-label">Payment</FieldLabel>
              <RadioGroup defaultValue="now" name="payment" aria-labelledby="payment-label">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="now" id="pay-now" />
                  <Label htmlFor="pay-now">Pay now</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="after" id="pay-after" />
                  <Label htmlFor="pay-after">Pay after the session</Label>
                </div>
              </RadioGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="notes">Anything we should know?</FieldLabel>
              <Textarea id="notes" name="notes" rows={3} />
            </Field>
            <Field orientation="horizontal">
              <Switch id="reminders" defaultChecked />
              <FieldLabel htmlFor="reminders">WhatsApp reminders</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="terms" name="terms" />
              <FieldLabel htmlFor="terms">I agree to the terms and consent</FieldLabel>
            </Field>
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <Button type="submit" size="lg" loading={submitting} className="w-full sm:w-auto">
              Submit (simulates a validation error)
            </Button>
          </FieldGroup>
        </form>
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
