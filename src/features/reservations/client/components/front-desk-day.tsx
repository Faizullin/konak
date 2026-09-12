"use client";

import { useEnumLabels } from "@/lib/labels";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import NiceModal from "@ebay/nice-modal-react";
import { ChevronLeft, ChevronRight, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useErrorHandlers, useRefusalText } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  DAY_ROLE_VALUES,
  DayRole,
  nextStatuses,
  refuseStatusChange,
  RESERVATION_STATUS_VALUES,
  ReservationStatus,
  toStayDate,
  todayAt,
} from "@/features/reservations";
import { useBookingActions } from "../hooks/use-booking-actions";
import type { GeneralRouterOutputs } from "@/server/types";
import { trpc } from "@/utils/trpc";
import { WalkInFormNiceDialog } from "./walk-in-form-nice-dialog";

/**
 * The day a receptionist works down: who arrives, who leaves, who is staying.
 *
 * The grid answers "where is everyone this month"; this answers "what is left
 * to do today", which is a different question and a different shape — three
 * short lists, each row one action wide. Both read the same stays, and
 * `dayRoleOf` in `model/` is what keeps them agreeing.
 */

const MS_PER_DAY = 86_400_000;

/** How often the desk re-reads without being asked. See the note in the file. */
const REFRESH_MS = 30_000;

type Day = GeneralRouterOutputs["reservation"]["day"];
type DayStay = Day["arrivals"][number];

const ORDER = [DayRole.ARRIVAL, DayRole.DEPARTURE, DayRole.IN_HOUSE] as const;

/** What the desk calls the transition, rather than the state it lands in. */
/** Labels come from `actions.<status>`; the status is the key. */

/** The two that end a booking and are not undone by setting the column back. */
/**
 * What the desk calls the transition, rather than the state it lands in.
 *
 * A status arrives from the server as a string, so the key is checked before it
 * is read — an unrecognised one renders as itself rather than throwing.
 */
const DAY_ACTION_KEYS = {
  cancelTitle: "day.cancelTitle",
  cancelDescription: "day.cancelDescription",
  noShowTitle: "day.noShowTitle",
  noShowDescription: "day.noShowDescription",
};

/**
 * Per locale, not once at module scope. A formatter pinned to one language does
 * not follow a language switch, and a screen whose words move while its dates
 * stay put reads as half-translated.
 */
function useDayFormats() {
  const locale = useLocale();

  return useMemo(
    () => ({
      day: new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }),
      short: new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
    }),
    [locale]
  );
}

function DayRow({
  stay,
  today,
  href,
  pending,
  onAct,
}: {
  stay: DayStay;
  today: Date;
  href: string;
  pending: boolean;
  onAct: (stay: DayStay, status: ReservationStatus) => void;
}) {
  const statusLabels = useEnumLabels("reservationStatus", RESERVATION_STATUS_VALUES);
  const { label, asksFirst } = useBookingActions(DAY_ACTION_KEYS);
  const t = useTranslations("reservations");
  const formats = useDayFormats();
  const refusalText = useRefusalText();

  const actions = nextStatuses(stay.status).map((status) => ({
    status,
    // Only this stay is known here. A booking holding two rooms is answered by
    // the server, which reads them all; this picks the button.
    refusal: refuseStatusChange({ from: stay.status, to: status, stays: [stay], today }),
  }));

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 last:border-b-0">
      <span className="min-w-16 text-sm font-medium">
        {stay.roomNumber ?? <span className="text-muted-foreground italic">no room</span>}
      </span>
      <Link href={href} className="text-sm underline-offset-4 hover:underline">
        {stay.guestName ?? stay.reference}
      </Link>
      <span className="text-muted-foreground text-xs">
        {stay.roomTypeName} · {t("list.nightCount", { nights: stay.nights })} ·{" "}
        {formats.short.format(stay.checkIn)} → {formats.short.format(stay.checkOut)}
      </span>
      <Badge variant="outline" className="text-xs">
        {statusLabels[stay.status as ReservationStatus] ?? stay.status}
      </Badge>

      <div className="ml-auto flex items-center gap-2">
        {actions.map(({ status, refusal }) => (
          <Button
            key={status}
            size="sm"
            variant={asksFirst(status) ? "ghost" : "default"}
            className={cn(asksFirst(status) && "text-destructive hover:text-destructive")}
            disabled={pending || refusal !== null}
            // The reason travels with the disabled button, and both sides
            // resolve the same code — so they cannot say different things.
            title={refusalText(refusal)}
            onClick={() => onAct(stay, status)}
          >
            {label(status)}
          </Button>
        ))}
      </div>
    </li>
  );
}

function DayList({
  role,
  stays,
  today,
  bookingsHref,
  pending,
  onAct,
}: {
  role: DayRole;
  stays: DayStay[];
  today: Date;
  bookingsHref: string;
  pending: boolean;
  onAct: (stay: DayStay, status: ReservationStatus) => void;
}) {
  const labels = useEnumLabels("dayRole", DAY_ROLE_VALUES);
  const t = useTranslations("reservations");
  return (
    <section className="bg-card rounded border">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-medium">{labels[role]}</h3>
        <span className="text-muted-foreground text-xs">{stays.length}</span>
      </header>
      {stays.length === 0 ? (
        <p className="text-muted-foreground px-3 py-4 text-sm">{t("day.nothingToday")}</p>
      ) : (
        <ul>
          {stays.map((stay) => (
            <DayRow
              key={stay.id}
              stay={stay}
              today={today}
              href={`${bookingsHref}/${stay.publicId}`}
              pending={pending}
              onAct={onAct}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function FrontDeskDay({
  propertyId,
  timezone,
  orgSlug,
  propertySlug,
}: {
  propertyId: number;
  timezone: string;
  orgSlug: string;
  propertySlug: string;
}) {
  const { label, confirmed } = useBookingActions(DAY_ACTION_KEYS);
  const formats = useDayFormats();
  const t = useTranslations("reservations");
  const { handleError } = useErrorHandlers();
  const today = useMemo(() => todayAt(timezone), [timezone]);
  const [day, setDay] = useState(today);
  const [refusal, setRefusal] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const input = { propertyId, day };

  const { data, isLoading } = trpc.reservation.day.useQuery(input, {
    // Real-time, decided in Phase 4: polling, not a subscription. Two
    // receptionists on one desk go stale in seconds, and this closes that
    // without a transport we would have to own — Next route handlers do not
    // hold a socket, and the grid is one bounded query either way. Revisit when
    // a channel manager starts writing bookings nobody here made.
    refetchInterval: REFRESH_MS,
    placeholderData: (previous) => previous,
  });

  const setStatus = trpc.reservation.setStatus.useMutation({
    onMutate: () => setRefusal(null),
    onSuccess: (reservation) => {
      toast.success(`${label(reservation.status)} — ${reservation.reference}`);
    },
    onError: (error) => {
      const app = handleError(error, { toast: false });
      setRefusal(app?.message ?? t("day.changeRefused"));
    },
    onSettled: () => {
      utils.reservation.day.invalidate();
      utils.reservation.grid.invalidate();
    },
  });

  // A status belongs to the booking, not to one of its rooms, so acting on a
  // row acts on the reservation behind it.
  const act = async (stay: DayStay, status: ReservationStatus) => {
    if (!(await confirmed(status))) return;
    setStatus.mutate({ propertyId, id: stay.reservationId, status });
  };

  const shiftDay = (days: number) =>
    setDay((current) => toStayDate(new Date(current.getTime() + days * MS_PER_DAY)));

  const lists: Record<DayRole, DayStay[]> = {
    ARRIVAL: data?.arrivals ?? [],
    DEPARTURE: data?.departures ?? [],
    IN_HOUSE: data?.inHouse ?? [],
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={t("day.previousDay")}
          onClick={() => shiftDay(-1)}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-48 text-sm font-medium">{formats.day.format(day)}</span>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("day.nextDay")}
          onClick={() => shiftDay(1)}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={day.getTime() === today.getTime()}
          onClick={() => setDay(today)}
        >
          {t("day.today")}
        </Button>

        <Button
          className="ml-auto"
          onClick={() => NiceModal.show(WalkInFormNiceDialog, { propertyId })}
        >
          <UserPlus />
          {t("day.walkIn")}
        </Button>
      </div>

      {refusal && <p className="text-destructive text-sm">{refusal}</p>}

      {isLoading && !data ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {ORDER.map((role) => (
            <Skeleton key={role} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          {ORDER.map((role) => (
            <DayList
              key={role}
              role={role}
              stays={lists[role]}
              today={today}
              bookingsHref={`/dashboard/orgs/${orgSlug}/front-desk/${propertySlug}/bookings`}
              pending={setStatus.isPending}
              onAct={act}
            />
          ))}
        </div>
      )}
    </div>
  );
}
