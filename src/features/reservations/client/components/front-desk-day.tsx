"use client";

import NiceModal from "@ebay/nice-modal-react";
import { ChevronLeft, ChevronRight, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm-nice-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { handleError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  DAY_ROLE_LABELS,
  DayRole,
  nextStatuses,
  refuseStatusChange,
  RESERVATION_STATUS_LABELS,
  ReservationStatus,
  toStayDate,
  todayAt,
} from "@/features/reservations";
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
const STATUS_ACTION: Record<string, string> = {
  [ReservationStatus.CONFIRMED]: "Confirm",
  [ReservationStatus.CHECKED_IN]: "Check in",
  [ReservationStatus.CHECKED_OUT]: "Check out",
  [ReservationStatus.NO_SHOW]: "No show",
  [ReservationStatus.CANCELLED]: "Cancel",
};

/** The two that end a booking and are not undone by setting the column back. */
const ASKS_FIRST: Record<string, { title: string; description: string }> = {
  [ReservationStatus.CANCELLED]: {
    title: "Cancel this booking?",
    description: "The room goes back on sale for those nights.",
  },
  [ReservationStatus.NO_SHOW]: {
    title: "Mark as a no-show?",
    description: "The booking ends and the nights are released.",
  },
};

const dayFormat = new Intl.DateTimeFormat("en", {
  weekday: "short",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const shortFormat = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function DayRow({
  stay,
  today,
  pending,
  onAct,
}: {
  stay: DayStay;
  today: Date;
  pending: boolean;
  onAct: (stay: DayStay, status: ReservationStatus) => void;
}) {
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
      <span className="text-sm">{stay.guestName ?? stay.reference}</span>
      <span className="text-muted-foreground text-xs">
        {stay.roomTypeName} · {stay.nights} {stay.nights === 1 ? "night" : "nights"} ·{" "}
        {shortFormat.format(stay.checkIn)} → {shortFormat.format(stay.checkOut)}
      </span>
      <Badge variant="outline" className="text-xs">
        {RESERVATION_STATUS_LABELS[stay.status as ReservationStatus] ?? stay.status}
      </Badge>

      <div className="ml-auto flex items-center gap-2">
        {actions.map(({ status, refusal }) => (
          <Button
            key={status}
            size="sm"
            variant={ASKS_FIRST[status] ? "ghost" : "default"}
            className={cn(ASKS_FIRST[status] && "text-destructive hover:text-destructive")}
            disabled={pending || refusal !== null}
            // The reason travels with the disabled button: the rule and the
            // sentence are the same object in `model/`.
            title={refusal ?? undefined}
            onClick={() => onAct(stay, status)}
          >
            {STATUS_ACTION[status] ?? status}
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
  pending,
  onAct,
}: {
  role: DayRole;
  stays: DayStay[];
  today: Date;
  pending: boolean;
  onAct: (stay: DayStay, status: ReservationStatus) => void;
}) {
  return (
    <section className="bg-card rounded border">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-medium">{DAY_ROLE_LABELS[role]}</h3>
        <span className="text-muted-foreground text-xs">{stays.length}</span>
      </header>
      {stays.length === 0 ? (
        <p className="text-muted-foreground px-3 py-4 text-sm">Nothing today.</p>
      ) : (
        <ul>
          {stays.map((stay) => (
            <DayRow key={stay.id} stay={stay} today={today} pending={pending} onAct={onAct} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function FrontDeskDay({ propertyId, timezone }: { propertyId: number; timezone: string }) {
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
      toast.success(
        `${STATUS_ACTION[reservation.status] ?? reservation.status} — ${reservation.reference}`
      );
    },
    onError: (error) => {
      const app = handleError(error, { toast: false });
      setRefusal(app?.message ?? "That change was refused");
    },
    onSettled: () => {
      utils.reservation.day.invalidate();
      utils.reservation.grid.invalidate();
    },
  });

  // A status belongs to the booking, not to one of its rooms, so acting on a
  // row acts on the reservation behind it.
  const act = async (stay: DayStay, status: ReservationStatus) => {
    const ask = ASKS_FIRST[status];
    if (ask && !(await confirm({ ...ask, destructive: true, confirmLabel: STATUS_ACTION[status] })))
      return;
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
          aria-label="Previous day"
          onClick={() => shiftDay(-1)}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-48 text-sm font-medium">{dayFormat.format(day)}</span>
        <Button variant="outline" size="icon" aria-label="Next day" onClick={() => shiftDay(1)}>
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={day.getTime() === today.getTime()}
          onClick={() => setDay(today)}
        >
          Today
        </Button>

        <Button
          className="ml-auto"
          onClick={() => NiceModal.show(WalkInFormNiceDialog, { propertyId })}
        >
          <UserPlus />
          Walk-in
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
              pending={setStatus.isPending}
              onAct={act}
            />
          ))}
        </div>
      )}
    </div>
  );
}
