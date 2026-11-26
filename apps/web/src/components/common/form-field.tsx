'use client';

import { useId, type ReactNode } from 'react';
import {
  Controller,
  type Control,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';

/** Spread onto the input so its label, hint and error are linked for screen readers. */
export interface FormControlProps {
  id: string;
  'aria-invalid': boolean | undefined;
  'aria-describedby': string | undefined;
}

interface FormFieldProps<T extends FieldValues, N extends FieldPath<T>> {
  control: Control<T>;
  name: N;
  label: ReactNode;
  description?: ReactNode;
  /** `horizontal` puts the control before the label: use for checkboxes and switches. */
  orientation?: 'vertical' | 'horizontal';
  children: (field: ControllerRenderProps<T, N>, control: FormControlProps, meta: FormFieldMeta) => ReactNode;
}

export interface FormFieldMeta {
  state: ControllerFieldState;
  /** The label's id. Use as `aria-labelledby` on groups (radio groups) that `htmlFor` can't label. */
  labelId: string;
}

/**
 * One form field: label, the control, an optional hint and the error message, wired to react-hook-form.
 *
 *   <FormField control={form.control} name="email" label="Email">
 *     {(field, control) => <Input type="email" {...field} {...control} />}
 *   </FormField>
 */
export function FormField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  label,
  description,
  orientation = 'vertical',
  children,
}: FormFieldProps<T, N>) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const labelId = `${id}-label`;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const invalid = fieldState.invalid;
        const describedBy = [description ? descriptionId : null, invalid ? errorId : null].filter(Boolean).join(' ');
        const controlProps: FormControlProps = {
          id,
          'aria-invalid': invalid || undefined,
          'aria-describedby': describedBy || undefined,
        };
        const error = invalid ? <FieldError id={errorId} errors={[fieldState.error]} /> : null;
        const hint = description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null;
        const meta: FormFieldMeta = { state: fieldState, labelId };

        if (orientation === 'horizontal') {
          return (
            <Field orientation="horizontal" data-invalid={invalid || undefined}>
              {children(field, controlProps, meta)}
              <FieldContent>
                <FieldLabel id={labelId} htmlFor={id}>
                  {label}
                </FieldLabel>
                {hint}
                {error}
              </FieldContent>
            </Field>
          );
        }

        return (
          <Field data-invalid={invalid || undefined}>
            <FieldLabel id={labelId} htmlFor={id}>
              {label}
            </FieldLabel>
            {children(field, controlProps, meta)}
            {hint}
            {error}
          </Field>
        );
      }}
    />
  );
}
