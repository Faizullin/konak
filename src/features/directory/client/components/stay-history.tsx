"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RESERVATION_STATUS_VALUES, ReservationStatus } from "@/features/reservations";
import { useEnumLabels } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { trpc } from "@/utils/trpc";

/**
 * Where this person has stayed.
 *
 * The question a receptionist asks before any other when a guest is on the
 * phone — *have they been here before* — and the reason a directory entry is
 * worth keeping at all. Each row opens the booking, so the two halves of the
 * product join up rather than merely both existing.
 */
export function StayHistory({
  organizationId,
  personId,
  orgSlug,
}: {
  organizationId: number;
  personId: number;
  orgSlug: string;
}) {
  const t = useTranslations("directory");
  const locale = useLocale();
  const statusLabels = useEnumLabels("reservationStatus", RESERVATION_STATUS_VALUES);

  const { data, isLoading } = trpc.directory.stayHistory.useQuery({ organizationId, personId });

  const dates = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }),
    [locale]
  );

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">{t("stays.heading")}</h2>

      {!data || data.length === 0 ? (
        // "Nothing yet" and "nothing matched" are different messages, and this
        // is the one people misread as breakage.
        <p className="text-muted-foreground text-sm">{t("stays.empty")}</p>
      ) : (
        <ul className="divide-y rounded border">
          {data.map((stay) => (
            <li key={stay.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <Link
                href={`/dashboard/orgs/${orgSlug}/front-desk/${stay.property.slug}/bookings/${stay.publicId}`}
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                {stay.checkIn && stay.checkOut
                  ? `${dates.format(stay.checkIn)} → ${dates.format(stay.checkOut)}`
                  : stay.reference}
              </Link>

              <span className="text-muted-foreground text-xs">
                {t("stays.nightCount", { nights: stay.nights })}
              </span>
              <span className="text-muted-foreground text-xs">
                {stay.rooms.length > 0 ? stay.rooms.join(", ") : stay.roomTypes.join(", ")}
              </span>
              <span className="text-muted-foreground text-xs">{stay.property.name}</span>

              <Badge variant="outline" className="text-xs">
                {statusLabels[stay.status as ReservationStatus] ?? stay.status}
              </Badge>

              <span className="ml-auto text-sm tabular-nums">
                {formatMoney(stay.totalMinor, stay.currencyCode, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
