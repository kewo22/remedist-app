'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { mockFail } from '@/lib/api/mocks/helpers';
import { applyApiErrors } from '@/lib/forms';

// Client-side checks give quick feedback; the API still validates everything.
// TODO: use the shared phone rule (packages/shared/rules) once it's on main.
const schema = z.object({
  name: z.string().trim().min(1, { error: 'Enter your full name.' }),
  email: z.email({ error: 'Enter a valid email address.' }),
  phone: z
    .string()
    .trim()
    .regex(/^\+[0-9][0-9\s-]{6,19}$/, { error: 'Enter the number with its country code, e.g. +94 77 123 4567.' }),
  sessionType: z.enum(['initial', 'follow-up'], { error: 'Choose a session type.' }),
  payment: z.enum(['now', 'after']),
  notes: z.string().max(1000, { error: 'Keep this under 1,000 characters.' }),
  reminders: z.boolean(),
  terms: z.boolean().refine((value) => value, { error: 'Please accept the terms to continue.' }),
});

type SampleFormInput = z.input<typeof schema>;

const FIELDS = Object.keys(schema.shape) as (keyof SampleFormInput)[];

export function SampleForm() {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      sessionType: undefined,
      payment: 'now',
      notes: '',
      reminders: true,
      terms: false,
    } satisfies Partial<SampleFormInput>,
  });

  const serverError = form.formState.errors.root?.server?.message;

  // Runs only after the zod checks pass. The mock API then rejects the phone number,
  // to show how a VALIDATION_FAILED response lands on the form.
  async function onSubmit() {
    try {
      await mockFail(400, 'VALIDATION_FAILED', 'Please check the highlighted fields.', [
        { field: 'phone', messages: ["This number can't receive WhatsApp messages."] },
      ]);
      toast.success('Saved');
    } catch (error) {
      applyApiErrors(error, form.setError, FIELDS);
    }
  }

  return (
    <Card className="max-w-xl">
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <FormField control={form.control} name="name" label="Full name">
              {(field, control) => <Input autoComplete="name" {...field} {...control} />}
            </FormField>

            <FormField control={form.control} name="email" label="Email">
              {(field, control) => <Input type="email" autoComplete="email" {...field} {...control} />}
            </FormField>

            <FormField control={form.control} name="phone" label="WhatsApp number" description="We send reminders here.">
              {(field, control) => (
                <Input type="tel" autoComplete="tel" placeholder="+94 77 123 4567" {...field} {...control} />
              )}
            </FormField>

            <FormField control={form.control} name="sessionType" label="Session type">
              {(field, control) => (
                <Select name={field.name} value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full" {...control}>
                    <SelectValue placeholder="Choose a session" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="initial">Initial consultation</SelectItem>
                    <SelectItem value="follow-up">Follow-up session</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </FormField>

            <FormField control={form.control} name="payment" label="Payment">
              {(field, control, { labelId }) => (
                <RadioGroup
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onValueChange={field.onChange}
                  aria-labelledby={labelId}
                  {...control}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="now" id={`${control.id}-now`} />
                    <Label htmlFor={`${control.id}-now`}>Pay now</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="after" id={`${control.id}-after`} />
                    <Label htmlFor={`${control.id}-after`}>Pay after the session</Label>
                  </div>
                </RadioGroup>
              )}
            </FormField>

            <FormField control={form.control} name="notes" label="Anything we should know?">
              {(field, control) => <Textarea rows={3} {...field} {...control} />}
            </FormField>

            <FormField control={form.control} name="reminders" label="WhatsApp reminders" orientation="horizontal">
              {(field, control) => (
                <Switch
                  ref={field.ref}
                  name={field.name}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  onBlur={field.onBlur}
                  {...control}
                />
              )}
            </FormField>

            <FormField
              control={form.control}
              name="terms"
              label="I agree to the terms and consent"
              orientation="horizontal"
            >
              {(field, control) => (
                <Checkbox
                  ref={field.ref}
                  name={field.name}
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  onBlur={field.onBlur}
                  {...control}
                />
              )}
            </FormField>

            {serverError && (
              <p role="alert" className="text-sm text-destructive">
                {serverError}
              </p>
            )}

            <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="w-full sm:w-auto">
              Submit (the mock API rejects the phone)
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
