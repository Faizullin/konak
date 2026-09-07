"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/utils/trpc";

/**
 * Reads the `User` row over tRPC rather than the session, so the card shows
 * the live row — a role changed in another tab lands here.
 */
export function CurrentUserCard() {
  const { data, isLoading, error } = trpc.user.getCurrent.useQuery();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your account</CardTitle>
        <CardDescription>Your user row, as the server sees it.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Same grid as the `dl` below, so the card does not resize on arrival. */}
        {isLoading && (
          <div className="grid grid-cols-[8rem_1fr] gap-y-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-24" />
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error.message}</p>}

        {data && (
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{data.name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium">{data.email}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd className="font-medium">{data.role}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
