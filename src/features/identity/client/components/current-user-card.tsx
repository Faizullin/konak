"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/utils/trpc";

/**
 * Reads the `User` row over tRPC rather than the session, so the card shows
 * the live row — a role changed in another tab lands here.
 */
export function CurrentUserCard() {
  const t = useTranslations("identity");
  const { data, isLoading, error } = trpc.user.getCurrent.useQuery();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("account.title")}</CardTitle>
        <CardDescription>{t("account.description")}</CardDescription>
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
            <dt className="text-muted-foreground">{t("account.name")}</dt>
            <dd className="font-medium">{data.name}</dd>
            <dt className="text-muted-foreground">{t("account.email")}</dt>
            <dd className="font-medium">{data.email}</dd>
            <dt className="text-muted-foreground">{t("account.role")}</dt>
            <dd className="font-medium">{data.role}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
