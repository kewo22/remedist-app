import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

/** The frame for the sign-up, login and password reset screens. */
export function AuthCard({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <h1 className="text-3xl">{title}</h1>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">{children}</CardContent>
      {footer && <CardFooter className="flex-col items-start gap-2 text-sm text-muted-foreground">{footer}</CardFooter>}
    </Card>
  );
}

/** "or" between Google and the email form. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3 text-xs tracking-wide text-muted-foreground uppercase" role="separator">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** The form-level error from applyApiErrors (`errors.root.server`). */
export function FormServerError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
