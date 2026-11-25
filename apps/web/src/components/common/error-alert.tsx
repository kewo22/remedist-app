import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/api/errors';
import { cn } from '@/lib/utils';

interface ErrorAlertProps {
  /** Anything thrown: shown through getErrorMessage, so raw errors never reach the screen. */
  error: unknown;
  title?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

export function ErrorAlert({ error, title = 'Something went wrong', onRetry, retrying, className }: ErrorAlertProps) {
  return (
    <Alert variant="destructive" className={cn('border-destructive/30', className)}>
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{getErrorMessage(error)}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry} loading={retrying}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
