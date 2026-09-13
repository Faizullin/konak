"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { personDisplayName } from "@/features/directory";
import { nightsBetween, toDayInput } from "@/features/reservations";
import { useBooking, type Booking } from "@/features/reservations/client/hooks/use-booking";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Основное: what the booking is, and what may be done to it.
 *
 * Presentation only. Which buttons exist, which are refused and why, and what
 * a refusal says are all `useBooking` — so this file can be replaced wholesale
 * by a second style library without any of those decisions being made twice.
 *
 * Denser than the dashboard's card on purpose: the facts are a strip rather
 * than a stack of headed sections, because a receptionist reads this with a
 * guest waiting.
 */

/** The desk names the booking above the tabs, so the questions can be short. */
const DESK_ACTION_KEYS = {
  cancelTitle: "card.cancelTitle",
  cancelDescription: "card.cancelDescription",
  noShowTitle: "card.noShowTitle",
  noShowDescription: "card.noShowDescription",
};

export function DeskBookingMain({
  propertyId,
  publicId,
  timezone,
  gridHref,
  directoryHref,
}: {
  propertyId: number;
  publicId: string;
  timezone: string;
  /** The desk's base path; the arrival's date is appended, so the grid opens
      on the week this booking is in rather than on today. */
  gridHref: string;
  /** The directory, so a guest can be read rather than only named. */
  directoryHref: string;
}) {
  const t = useTranslations("reservations");
  const locale = useLocale();
  const { booking, isLoading, actions, reasons, statusLabel, pending } = useBooking({
    propertyId,
    publicId,
    timezone,
    keys: DESK_ACTION_KEYS,
  });

  if (isLoading || !booking) return <Skeleton className="h-96 w-full" />;

  // The earliest stay: a booking holding two rooms over different dates is
  // still one arrival at the desk.
  const arrival = booking.stays.reduce<Date | null>(
    (first, stay) => (first === null || stay.checkIn < first ? stay.checkIn : first),
    null
  );

  return (
    <div className="space-y-4">
      <div className="bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded border px-3 py-2">
        <Badge variant="outline">{statusLabel(booking.status)}</Badge>
        <span className="text-muted-foreground text-xs">{booking.reference}</span>

        {arrival && (
          <Button
            nativeButton={false}
            variant="ghost"
            size="sm"
            render={<Link href={`${gridHref}?on=${toDayInput(arrival)}`} />}
          >
            {t("card.showOnGrid")}
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {actions.map((action) => (
            <Button
              key={action.status}
              size="sm"
              variant={action.destructive ? "outline" : "default"}
              className={cn(action.destructive && "text-destructive hover:text-destructive")}
              disabled={pending || action.refusal !== undefined}
              // The reason travels with the disabled button, and both sides
              // resolve the same code — so they cannot say different things.
              title={action.refusal}
              onClick={action.run}
            >
              {action.label}
            </Button>
          ))}
          {actions.length === 0 && (
            <span className="text-muted-foreground text-xs">{t("grid.nothingLeft")}</span>
          )}
        </div>

        {reasons.length > 0 && (
          <p className="text-muted-foreground w-full text-xs">{reasons.join(" · ")}</p>
        )}
      </div>

      <Facts booking={booking} locale={locale} />

      <div className="overflow-x-auto rounded border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("card.dates")}</TableHead>
              <TableHead>{t("card.nights")}</TableHead>
              <TableHead>{t("card.roomType")}</TableHead>
              <TableHead>{t("card.room")}</TableHead>
              <TableHead>{t("card.ratePlan")}</TableHead>
              <TableHead>{t("card.occupancy")}</TableHead>
              <TableHead className="text-right">{t("card.total")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {booking.stays.map((stay) => (
              <StayRow key={stay.id} stay={stay} locale={locale} />
            ))}
          </TableBody>
        </Table>
      </div>

      {booking.guests.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {booking.guests.map((guest) => (
            <li key={guest.person.id}>
              {/* A name that opens the person: their other stays, their
                  documents, and what the hotel knows about them. */}
              <Link href={`${directoryHref}/${guest.person.id}`}>
                <Badge
                  variant={guest.isPrimary ? "default" : "outline"}
                  className="hover:underline"
                >
                  {personDisplayName(guest.person)}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {booking.notes && (
        <p className="text-muted-foreground rounded border p-3 text-sm whitespace-pre-wrap">
          {booking.notes}
        </p>
      )}
    </div>
  );
}

/**
 * What was quoted, what is paid, and what is left.
 *
 * The balance is arithmetic on two stored numbers rather than a third column,
 * because a stored balance is a number that can disagree with the two it came
 * from.
 */
function Facts({ booking, locale }: { booking: Booking; locale: string }) {
  const t = useTranslations("reservations");
  const money = (minor: number) => formatMoney(minor, booking.currencyCode, locale);
  const balance = booking.totalMinor - booking.paidMinor;

  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
      <div>
        <dt className="text-muted-foreground text-xs">{t("card.total")}</dt>
        <dd className="font-medium">{money(booking.totalMinor)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">{t("card.paid")}</dt>
        <dd className="font-medium">{money(booking.paidMinor)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">{t("card.balance")}</dt>
        <dd className={cn("font-medium", balance > 0 && "text-destructive")}>{money(balance)}</dd>
      </div>
    </dl>
  );
}

function StayRow({ stay, locale }: { stay: Booking["stays"][number]; locale: string }) {
  const t = useTranslations("reservations");
  const dates = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }),
    [locale]
  );

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">
        {dates.format(stay.checkIn)} → {dates.format(stay.checkOut)}
      </TableCell>
      <TableCell>{nightsBetween(stay.checkIn, stay.checkOut)}</TableCell>
      <TableCell>{stay.roomType.name}</TableCell>
      <TableCell>
        {stay.room?.number ?? (
          <span className="text-muted-foreground italic">{t("card.noRoomYet")}</span>
        )}
      </TableCell>
      <TableCell>
        {stay.ratePlan?.name ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {t("card.occupancyValue", { adults: stay.adults, children: stay.children })}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {formatMoney(stay.totalMinor, stay.currencyCode, locale)}
      </TableCell>
    </TableRow>
  );
}
