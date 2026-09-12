"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { toast } from "sonner";
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
import Link from "next/link";
import {
  nextStatuses,
  nightsBetween,
  refuseStatusChange,
  RESERVATION_STATUS_VALUES,
  ReservationStatus,
  toDayInput,
  todayAt,
} from "@/features/reservations";
import { useErrorHandlers, useRefusalText } from "@/lib/errors";
import { useEnumLabels } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { GeneralRouterOutputs } from "@/server/types";
import { trpc } from "@/utils/trpc";
import { useBookingActions } from "../hooks/use-booking-actions";

type Booking = GeneralRouterOutputs["reservation"]["byPublicId"];

/** The card names the booking in its heading, so the questions can be short. */
const CARD_ACTION_KEYS = {
  cancelTitle: "card.cancelTitle",
  cancelDescription: "card.cancelDescription",
  noShowTitle: "card.noShowTitle",
  noShowDescription: "card.noShowDescription",
};

/**
 * One booking, whole.
 *
 * The grid's action bar answers for the chip that was clicked; this answers for
 * the reservation — every stay, every guest, the plans and the money. That is
 * the difference that makes it a card rather than a wider toolbar: a booking
 * holding two rooms is one commercial agreement and is refused as one.
 */
export function BookingCard({
  propertyId,
  publicId,
  timezone,
  gridHref,
}: {
  propertyId: number;
  publicId: string;
  timezone: string;
  /** The desk, so a booking can be seen in its own week rather than described. */
  gridHref: string;
}) {
  const t = useTranslations("reservations");
  const locale = useLocale();
  const statusLabels = useEnumLabels("reservationStatus", RESERVATION_STATUS_VALUES);
  const { label, confirmed } = useBookingActions(CARD_ACTION_KEYS);
  const refusalText = useRefusalText();
  const { handleError } = useErrorHandlers();

  const today = useMemo(() => todayAt(timezone), [timezone]);
  const utils = trpc.useUtils();
  const input = { propertyId, publicId };

  const { data, isLoading } = trpc.reservation.byPublicId.useQuery(input);

  const setStatus = trpc.reservation.setStatus.useMutation({
    onSuccess: (reservation) => {
      toast.success(`${label(reservation.status)} — ${reservation.reference}`);
    },
    onError: (error) => handleError(error),
    onSettled: () => {
      // The card, the grid and the day lists all draw this booking. A status
      // that moves on one and not the others is two screens disagreeing.
      utils.reservation.byPublicId.invalidate(input);
      utils.reservation.grid.invalidate();
      utils.reservation.day.invalidate();
    },
  });

  if (isLoading || !data) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-8">
      <Summary booking={data} locale={locale} gridHref={gridHref} />

      <BookingActions
        booking={data}
        today={today}
        pending={setStatus.isPending}
        statusLabel={(status) => statusLabels[status as ReservationStatus] ?? status}
        actionLabel={label}
        refusalText={refusalText}
        onAct={async (status) => {
          if (!(await confirmed(status))) return;
          setStatus.mutate({ propertyId, id: data.id, status });
        }}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("card.stays")}</h2>
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
              {data.stays.map((stay) => (
                <StayRow key={stay.id} stay={stay} locale={locale} />
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <Money booking={data} locale={locale} />

      {data.guests.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t("card.guests")}</h2>
          <ul className="flex flex-wrap gap-2">
            {data.guests.map((guest) => (
              <li key={guest.person.id}>
                <Badge variant={guest.isPrimary ? "default" : "outline"}>
                  {personDisplayName(guest.person)}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.notes && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t("card.notes")}</h2>
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">{data.notes}</p>
        </section>
      )}
    </div>
  );
}

/**
 * What can be done to the booking, and why the rest cannot.
 *
 * `stays` is every stay on the reservation, which is the whole point: the
 * server reads them all, so a card that asked about one would offer a check-in
 * the server then refuses.
 */
function BookingActions({
  booking,
  today,
  pending,
  statusLabel,
  actionLabel,
  refusalText,
  onAct,
}: {
  booking: Booking;
  today: Date;
  pending: boolean;
  statusLabel: (status: string) => string;
  actionLabel: (status: string) => string;
  refusalText: (refusal: ReturnType<typeof refuseStatusChange>) => string | undefined;
  onAct: (status: ReservationStatus) => void;
}) {
  const t = useTranslations("reservations");

  const actions = nextStatuses(booking.status).map((status) => ({
    status,
    refusal: refuseStatusChange({
      from: booking.status,
      to: status,
      stays: booking.stays,
      today,
    }),
  }));
  const reasons = [...new Set(actions.flatMap((action) => refusalText(action.refusal) ?? []))];

  return (
    <div className="bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded border px-3 py-2">
      <Badge variant="outline">{statusLabel(booking.status)}</Badge>
      <span className="text-muted-foreground text-xs">{booking.reference}</span>

      <div className="ml-auto flex items-center gap-2">
        {actions.map(({ status, refusal }) => (
          <Button
            key={status}
            size="sm"
            variant={status === ReservationStatus.CONFIRMED ? "default" : "outline"}
            className={cn(
              (status === ReservationStatus.CANCELLED || status === ReservationStatus.NO_SHOW) &&
                "text-destructive hover:text-destructive"
            )}
            disabled={pending || refusal !== null}
            // The reason travels with the disabled button, and both sides
            // resolve the same code — so they cannot say different things.
            title={refusalText(refusal)}
            onClick={() => onAct(status)}
          >
            {actionLabel(status)}
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

/**
 * What is owed. The balance is arithmetic on two stored numbers rather than a
 * third column, because a stored balance is a number that can disagree with the
 * two it came from.
 */
function Money({ booking, locale }: { booking: Booking; locale: string }) {
  const t = useTranslations("reservations");
  const money = (minor: number) => formatMoney(minor, booking.currencyCode, locale);
  const balance = booking.totalMinor - booking.paidMinor;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">{t("card.money")}</h2>
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
      {/* Phase 6 owns the folio. Until it exists these are the reservation's own
          columns, and nothing on this screen can move them. */}
      <p className="text-muted-foreground text-xs">{t("card.folioLater")}</p>
    </section>
  );
}

/**
 * The booking in one line.
 *
 * Most bookings are one room for a few nights, and a table, a money section and
 * two headings is a page for a fact that fits in a sentence. The sections stay
 * for the bookings that need them; this is for the ones that do not.
 */
function Summary({
  booking,
  locale,
  gridHref,
}: {
  booking: Booking;
  locale: string;
  gridHref: string;
}) {
  const t = useTranslations("reservations");
  const dates = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }),
    [locale]
  );

  // A reservation arrives when its earliest stay does and ends when its last
  // one does — the same reading the refusals make.
  const arrival = booking.stays.at(0)?.checkIn ?? null;
  const departure = booking.stays.reduce<Date | null>(
    (latest, stay) => (!latest || stay.checkOut > latest ? stay.checkOut : latest),
    null
  );
  const rooms = booking.stays.map((stay) => stay.room?.number).filter(Boolean);

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {arrival && departure && (
        <span className="text-foreground font-medium whitespace-nowrap">
          {dates.format(arrival)} → {dates.format(departure)}
        </span>
      )}
      {arrival && departure && (
        <span>{t("list.nightCount", { nights: nightsBetween(arrival, departure) })}</span>
      )}
      <span>
        {rooms.length > 0
          ? rooms.join(", ")
          : [...new Set(booking.stays.map((stay) => stay.roomType.name))].join(", ")}
      </span>
      <span>{formatMoney(booking.totalMinor, booking.currencyCode, locale)}</span>

      {/* "Show me this on the grid" is the question a list cannot answer and a
          date-anchored window now can. */}
      {arrival && (
        <Link
          href={`${gridHref}?on=${toDayInput(arrival)}`}
          className="ml-auto underline-offset-4 hover:underline"
        >
          {t("card.showOnGrid")}
        </Link>
      )}
    </div>
  );
}
