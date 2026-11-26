'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ErrorAlert } from '@/components/common/error-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { clientAuthApi, clientAuthKeys } from '@/lib/api/client-auth';
import { signOutClient, signOutClientEverywhere } from '@/lib/auth/client-auth';

/** Placeholder portal home: loads the profile with the access token, and offers sign-out. */
export function PortalHome() {
  const profile = useQuery({
    queryKey: clientAuthKeys.me(),
    queryFn: ({ signal }) => clientAuthApi.me(signal),
  });
  const signOut = useMutation({ mutationFn: signOutClient });
  const signOutEverywhere = useMutation({ mutationFn: signOutClientEverywhere });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <Link href="/" className="font-display text-2xl font-semibold text-brand-green-deep">
        The Remedist
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-3xl">My account</h1>
          </CardTitle>
          <CardDescription>Your bookings, payments and forms will appear here.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {profile.isPending && (
            <div className="flex flex-col gap-2" aria-hidden="true">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
          )}
          {profile.isError && <ErrorAlert error={profile.error} onRetry={() => void profile.refetch()} retrying={profile.isFetching} />}
          {profile.data && (
            <dl className="grid gap-1 text-sm">
              <dt className="sr-only">Name</dt>
              <dd className="text-base font-semibold">{profile.data.name}</dd>
              <dt className="sr-only">Email</dt>
              <dd className="text-muted-foreground">{profile.data.email}</dd>
              <dt className="sr-only">Signs in with</dt>
              <dd className="text-muted-foreground">
                Signs in with {profile.data.authProvider === 'google' ? 'Google' : 'email and password'}
              </dd>
            </dl>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="outline" onClick={() => signOut.mutate()} loading={signOut.isPending}>
              Sign out
            </Button>
            <Button variant="ghost" onClick={() => signOutEverywhere.mutate()} loading={signOutEverywhere.isPending}>
              Sign out on every device
            </Button>
          </div>
          {signOutEverywhere.isError && <ErrorAlert error={signOutEverywhere.error} title="Couldn't sign out everywhere" />}
        </CardContent>
      </Card>
    </main>
  );
}
