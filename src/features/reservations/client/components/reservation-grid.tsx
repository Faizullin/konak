"use client";

import { useEnumLabels } from "@/lib/labels";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useErrorHandlers, useRefusalText } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { ROOM_STATUS_VALUES, RoomStatus } from "@/features/properties";
import {
  assignLanes,
  laneCount,
  monthWindowOf,
  nextStatuses,
  refuseStatusChange,
  RESERVATION_STATUS_VALUES,
  ReservationStatus,
  shiftMonths,
  spanInWindow,
  todayAt,
} from "@/features/reservations";
import { useBookingActions } from "../hooks/use-booking-actions";
import type { GeneralRouterOutputs } from "@/server/types";
import { trpc } from "@/utils/trpc";

type Grid = GeneralRouterOutputs["reservation"]["grid"];
type GridStay = Grid["rooms"][number]["stays"][number];

/**
 * The reservation grid: rooms down, dates across, one month visible.
 *
 * Deliberately not the `DataTable` stack — that is paginated rows over one
 * axis, and this is two axes where the cells are spans. The layout arithmetic
 * is not here either: `model/grid.ts` owns it, the server has already applied
 * it, and this file only positions what it is given.
 */

/**
 * `stayDateSchema` is `z.coerce.date()`, so a mutation's *input* type is
 * `unknown` — it accepts what the wire sends. The optimistic update reads the
 * variables back, so it narrows them here rather than trusting the shape.
 */
const asDate = (value: unknown) => (value instanceof Date ? value : new Date(String(value)));

/** A whole number of days from a stay date, which stays a stay date. */
function shiftDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Matches the day lists: the two surfaces read the same stays. */
const GRID_REFRESH_MS = 30_000;

const LABEL_WIDTH = "10rem";
const NIGHT_WIDTH = 2.5;
const LANE_HEIGHT = "1.75rem";

/**
 * Temporary, and Phase 12 replaces the palette. What is **not** temporary is
 * that colour is never the only cue: every pair of states differs by border
 * style or by `STATUS_MARK` as well as by hue, so the grid still reads for
 * someone who cannot tell sky from emerald. Front desks also run dim at night,
 * which is what the dark variants are for.
 */
const STATUS_CLASS: Record<string, string> = {
  [ReservationStatus.ENQUIRY]:
    "border-dashed border-muted-foreground/60 bg-muted text-muted-foreground",
  [ReservationStatus.CONFIRMED]:
    "border-sky-600/40 bg-sky-100 text-sky-950 dark:border-sky-400/50 dark:bg-sky-950 dark:text-sky-50",
  [ReservationStatus.CHECKED_IN]:
    "border-emerald-600/40 bg-emerald-100 text-emerald-950 dark:border-emerald-400/50 dark:bg-emerald-950 dark:text-emerald-50",
  [ReservationStatus.CHECKED_OUT]:
    "border-dotted border-slate-400/60 bg-slate-100 text-slate-700 dark:border-slate-400/50 dark:bg-slate-800 dark:text-slate-200",
};

/** The states the grid draws, in the order a booking passes through them. */
const STATUS_LEGEND = [
  ReservationStatus.ENQUIRY,
  ReservationStatus.CONFIRMED,
  ReservationStatus.CHECKED_IN,
  ReservationStatus.CHECKED_OUT,
] as const;

/**
 * The cue that is not colour. Shapes rather than letters, which stay legible at
 * the width of a one-night chip: hollow is a room still waiting, filled is a
 * guest in it, and a tick is a stay that is over.
 *
 * `aria-hidden`, because the chip's `title` already carries the status in words
 * — this is for the eye that cannot use the hue, not for the screen reader.
 */
const STATUS_MARK: Record<string, string> = {
  [ReservationStatus.ENQUIRY]: "?",
  [ReservationStatus.CONFIRMED]: "○",
  [ReservationStatus.CHECKED_IN]: "●",
  [ReservationStatus.CHECKED_OUT]: "✓",
};

/** Cancelling reads longer here than in the day lists: a chip is not a row. */
const GRID_ACTION_KEYS = {
  cancelAction: "grid.cancelAction",
  cancelTitle: "grid.cancelTitle",
  cancelDescription: "grid.cancelDescription",
  noShowTitle: "grid.noShowTitle",
  noShowDescription: "grid.noShowDescription",
};

const dayFormat = new Intl.DateTimeFormat("en", { day: "numeric", timeZone: "UTC" });
const weekdayFormat = new Intl.DateTimeFormat("en", { weekday: "narrow", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("en", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const rangeFormat = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const isWeekend = (date: Date) => date.getUTCDay() === 0 || date.getUTCDay() === 6;

/** Every stay on the grid, whichever row or band it is drawn in. */
function everyStay(grid: Grid): GridStay[] {
  return [
    ...grid.rooms.flatMap((row) => row.stays),
    ...grid.unassigned.flatMap((band) => band.stays),
  ];
}

/**
 * The optimistic move, done the same way the server does it: put the stay in
 * its new row and re-lane both rows with the model's own comparator. A drag
 * that waited for a round trip would feel broken; the server stays the
 * authority, and `onError` puts the snapshot back.
 */
function placeStay(grid: Grid, moved: GridStay): Grid {
  const stayId = moved.id;
  const roomId = moved.roomId;
  const relane = (stays: GridStay[]) => {
    const laned = assignLanes(stays);
    return { lanes: laneCount(laned), stays: laned };
  };

  const bands = grid.unassigned.map((band) => ({
    ...band,
    ...relane(
      band.stays
        .filter((stay) => stay.id !== stayId)
        .concat(roomId === null && band.roomTypeId === moved.roomTypeId ? [moved] : [])
    ),
  }));
  const needsBand = roomId === null && !bands.some((band) => band.roomTypeId === moved.roomTypeId);

  return {
    ...grid,
    rooms: grid.rooms.map((row) => ({
      ...row,
      ...relane(
        row.stays.filter((stay) => stay.id !== stayId).concat(row.roomId === roomId ? [moved] : [])
      ),
    })),
    unassigned: needsBand
      ? [...bands, { roomTypeId: moved.roomTypeId, ...relane([moved]) }]
      : bands.filter((band) => band.stays.length > 0),
  };
}

/**
 * Which night of the chip the pointer is over, 0-based. A drag has to put the
 * grabbed night under the cursor, or a five-night booking jumps four days the
 * moment it is picked up.
 */
function nightUnder(event: { clientX: number }, element: HTMLElement, nights: number): number {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0) return 0;
  const index = Math.floor(((event.clientX - rect.left) / rect.width) * nights);
  return Math.min(Math.max(index, 0), Math.max(nights - 1, 0));
}

function StayChip({
  stay,
  onDragStart,
  onDragEnd,
  onSelect,
  onResize,
  selected,
  disabled,
}: {
  stay: GridStay;
  onDragStart: (stayId: number, grabNight: number) => void;
  onDragEnd: () => void;
  onSelect: (stayId: number) => void;
  onResize: (stay: GridStay, edge: "start" | "end", days: number) => void;
  selected: boolean;
  disabled: boolean;
}) {
  const statusLabels = useEnumLabels("reservationStatus", RESERVATION_STATUS_VALUES);
  const nights = Math.round((stay.checkOut.getTime() - stay.checkIn.getTime()) / 86_400_000);
  // Nights added or removed while the pointer is still down, so the edge
  // follows the cursor instead of jumping when the server answers.
  const [preview, setPreview] = useState<{ start: number; end: number } | null>(null);
  // A ref rather than state: `dragstart` fires before a re-render would land,
  // and a resize that also starts a drag moves the booking twice.
  const resizing = useRef(false);

  const startResize = (edge: "start" | "end") => (event: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    resizing.current = true;

    const chip = event.currentTarget.parentElement;
    if (!chip) return;
    const column = chip.getBoundingClientRect().width / Math.max(stay.nights, 1);
    const originX = event.clientX;

    const days = (clientX: number) => Math.round((clientX - originX) / Math.max(column, 1));
    const track = (moved: PointerEvent) => {
      const delta = days(moved.clientX);
      setPreview(edge === "start" ? { start: delta, end: 0 } : { start: 0, end: delta });
    };
    const finish = (released: PointerEvent) => {
      window.removeEventListener("pointermove", track);
      window.removeEventListener("pointerup", finish);
      setPreview(null);
      // The flag outlives the click that follows a pointerup, so it is cleared
      // after the event loop rather than inside it.
      setTimeout(() => (resizing.current = false), 0);

      const delta = days(released.clientX);
      if (delta !== 0) onResize(stay, edge, delta);
    };

    window.addEventListener("pointermove", track);
    window.addEventListener("pointerup", finish);
  };

  // Clamped so a preview never draws a stay shorter than one night.
  const shownOffset = stay.offset + (preview?.start ?? 0);
  const shownNights = Math.max(stay.nights - (preview?.start ?? 0) + (preview?.end ?? 0), 1);

  return (
    <button
      type="button"
      draggable={!disabled}
      onDragStart={(event) => {
        if (resizing.current) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        // Firefox refuses to start a drag without payload, even unused.
        event.dataTransfer.setData("text/plain", String(stay.id));
        onDragStart(stay.id, nightUnder(event, event.currentTarget, stay.nights));
      }}
      // A drag abandoned off a row still ends, and a stale grab would be
      // applied to the next drop.
      onDragEnd={onDragEnd}
      // Click selects rather than opening a menu: a menu on a draggable chip
      // opens on every drag, and the actions want more room than one anyway.
      onClick={() => onSelect(stay.id)}
      aria-pressed={selected}
      style={{ gridColumn: `${shownOffset + 1} / span ${shownNights}`, gridRow: stay.lane + 1 }}
      title={`${stay.reference} · ${statusLabels[stay.status as ReservationStatus] ?? stay.status} · ${rangeFormat.format(stay.checkIn)} → ${rangeFormat.format(stay.checkOut)} · ${nights} night${nights === 1 ? "" : "s"}`}
      className={cn(
        "relative z-10 mx-px flex items-center overflow-hidden rounded border px-1.5 text-xs whitespace-nowrap",
        "cursor-grab active:cursor-grabbing disabled:cursor-default",
        STATUS_CLASS[stay.status] ?? "border-border bg-card",
        // A clipped edge is not the real one, so it does not get a rounded cap.
        stay.continuesBefore && "rounded-l-none border-l-0",
        stay.continuesAfter && "rounded-r-none border-r-0",
        selected && "ring-ring ring-2 ring-offset-1"
      )}
      disabled={disabled}
    >
      {/* A clipped edge is not the real one, so it is not a handle: dragging it
          would move a date the grid cannot see. `model/grid.ts` decides which. */}
      {!stay.continuesBefore && !disabled && (
        <span
          role="presentation"
          onPointerDown={startResize("start")}
          className="hover:bg-foreground/20 absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l"
        />
      )}
      <span aria-hidden className="mr-0.5 shrink-0 opacity-70">
        {STATUS_MARK[stay.status] ?? "·"}
      </span>
      <span className="truncate">{stay.guestName ?? stay.reference}</span>
      {!stay.continuesAfter && !disabled && (
        <span
          role="presentation"
          onPointerDown={startResize("end")}
          className="hover:bg-foreground/20 absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r"
        />
      )}
    </button>
  );
}

/** A room change: the dates are untouched, so the span is too. */
function relocateStay(grid: Grid, stayId: number, roomId: number | null): Grid {
  const moving = everyStay(grid).find((stay) => stay.id === stayId);
  if (!moving || moving.roomId === roomId) return grid;
  return placeStay(grid, { ...moving, roomId });
}

/**
 * A date change: the span has to be recomputed, and by `spanInWindow` rather
 * than by hand — it is the same function the server laid the grid out with, so
 * an optimistic chip cannot land a column away from where the refetch puts it.
 *
 * A stay dragged clean out of the month returns the grid untouched: there is no
 * span to draw, and the refetch is what removes it.
 */
function rescheduleStay(
  grid: Grid,
  stayId: number,
  range: { checkIn: Date; checkOut: Date },
  roomId: number | null
): Grid {
  const moving = everyStay(grid).find((stay) => stay.id === stayId);
  if (!moving) return grid;

  const span = spanInWindow(range, {
    from: grid.window.from,
    nights: grid.window.nights.length,
  });
  if (!span) return grid;

  return placeStay(grid, { ...moving, ...span, ...range, roomId });
}

/** The night columns of one row: the calendar rules, plus whatever sits on them. */
function NightArea({
  nights,
  lanes,
  children,
  onDropStay,
  className,
}: {
  nights: Date[];
  lanes: number;
  children?: ReactNode;
  onDropStay?: (column: number) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("relative grid flex-1", className)}
      style={{
        gridTemplateColumns: `repeat(${nights.length}, minmax(${NIGHT_WIDTH}rem, 1fr))`,
        gridTemplateRows: `repeat(${Math.max(lanes, 1)}, ${LANE_HEIGHT})`,
      }}
      onDragOver={onDropStay ? (event) => event.preventDefault() : undefined}
      // The column is read from the pointer rather than from a per-cell
      // handler: a chip sits above the cells, and dropping on one must still
      // say which night it landed on.
      onDrop={
        onDropStay
          ? (event) => {
              event.preventDefault();
              onDropStay(nightUnder(event, event.currentTarget, nights.length));
            }
          : undefined
      }
    >
      {nights.map((night, index) => (
        <div
          key={night.toISOString()}
          style={{ gridColumn: index + 1, gridRow: `1 / -1` }}
          className={cn("border-border/60 border-l", isWeekend(night) && "bg-muted/40")}
        />
      ))}
      {children}
    </div>
  );
}

/**
 * What can be done to the selected booking, and why the rest cannot.
 *
 * The legal moves come from the same machine the server enforces, and a refused
 * one stays visible but disabled with its reason — "assign a room first" is the
 * screen teaching what the desk has to do, which hiding the button would not.
 */
function StayActions({
  stay,
  today,
  roomNumber,
  href,
  pending,
  onAct,
  onClose,
}: {
  stay: GridStay;
  today: Date;
  roomNumber: string | null;
  href: string;
  pending: boolean;
  onAct: (status: ReservationStatus) => void;
  onClose: () => void;
}) {
  const statusLabels = useEnumLabels("reservationStatus", RESERVATION_STATUS_VALUES);
  const { label, asksFirst } = useBookingActions(GRID_ACTION_KEYS);
  const t = useTranslations("reservations");
  const refusalText = useRefusalText();

  const actions = nextStatuses(stay.status).map((status) => ({
    status,
    // Only this stay is known here. A booking holding two rooms is answered by
    // the server, which reads them all; this picks the button.
    refusal: refuseStatusChange({ from: stay.status, to: status, stays: [stay], today }),
  }));
  const reasons = [...new Set(actions.flatMap((action) => refusalText(action.refusal) ?? []))];

  return (
    <div className="bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded border px-3 py-2">
      <span className="text-sm font-medium">{stay.guestName ?? stay.reference}</span>
      <span className="text-muted-foreground text-xs">
        {stay.reference} · {statusLabels[stay.status as ReservationStatus]} ·{" "}
        {rangeFormat.format(stay.checkIn)} → {rangeFormat.format(stay.checkOut)} ·{" "}
        {roomNumber ? t("grid.roomNumber", { number: roomNumber }) : t("grid.noRoomYet")}
      </span>

      <div className="ml-auto flex items-center gap-2">
        {/* This bar answers for the chip that was clicked. The reservation
            behind it — its other rooms, its guests, its money — is on the
            card, which is also the only version of this that survives a
            refresh. */}
        <Button nativeButton={false} size="sm" variant="outline" render={<Link href={href} />}>
          {t("grid.open")}
        </Button>
        {actions.map(({ status, refusal }) => (
          <Button
            key={status}
            size="sm"
            variant={asksFirst(status) ? "ghost" : "default"}
            className={cn(asksFirst(status) && "text-destructive hover:text-destructive")}
            disabled={pending || refusal !== null}
            title={refusalText(refusal)}
            onClick={() => onAct(status)}
          >
            {label(status)}
          </Button>
        ))}
        {actions.length === 0 && (
          <span className="text-muted-foreground text-xs">{t("grid.nothingLeft")}</span>
        )}
        <Button size="icon" variant="ghost" aria-label={t("grid.close")} onClick={onClose}>
          <X />
        </Button>
      </div>

      {reasons.length > 0 && (
        <p className="text-muted-foreground w-full text-xs">{reasons.join(" · ")}</p>
      )}
    </div>
  );
}

function RowLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      style={{ width: LABEL_WIDTH }}
      className={cn(
        "bg-background sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r px-2 text-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

export function ReservationGrid({
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
  const statusLabels = useEnumLabels("reservationStatus", RESERVATION_STATUS_VALUES);
  const labels = useEnumLabels("roomStatus", ROOM_STATUS_VALUES);
  const { label, confirmed } = useBookingActions(GRID_ACTION_KEYS);
  const t = useTranslations("reservations");
  const { handleError } = useErrorHandlers();
  const [anchor, setAnchor] = useState(() => monthWindowOf(new Date()).from);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: number; grabNight: number } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const today = useMemo(() => todayAt(timezone), [timezone]);

  const month = monthWindowOf(anchor);
  const utils = trpc.useUtils();
  const input = { propertyId, from: month.from, to: month.to };

  const { data, isLoading } = trpc.reservation.grid.useQuery(input, {
    // Keep last month on screen while the next one loads; a grid that blanks
    // between clicks reads as broken.
    placeholderData: (previous) => previous,
    // Real-time, decided in Phase 4: polling rather than a subscription. See
    // the note in `front-desk-day.tsx`, which sets the interval.
    refetchInterval: GRID_REFRESH_MS,
  });

  /**
   * The payload grouped once, rather than scanned per cell: the counts row asks
   * for a type and a night, and `find` over the whole availability array for
   * every one of them is the window's length times the number of types.
   */
  const byType = useMemo(() => {
    const rooms = new Map<number, Grid["rooms"]>();
    const bands = new Map<number, Grid["unassigned"][number]>();
    const nightly = new Map<string, Grid["availability"][number]>();

    for (const room of data?.rooms ?? []) {
      const drawn = rooms.get(room.roomTypeId);
      if (drawn) drawn.push(room);
      else rooms.set(room.roomTypeId, [room]);
    }
    for (const band of data?.unassigned ?? []) bands.set(band.roomTypeId, band);
    for (const row of data?.availability ?? []) {
      nightly.set(`${row.roomTypeId}:${row.date.getTime()}`, row);
    }

    return { rooms, bands, nightly };
  }, [data]);

  const assign = trpc.reservation.assignRoom.useMutation({
    onMutate: async (variables) => {
      setRefusal(null);
      await utils.reservation.grid.cancel(input);
      const snapshot = utils.reservation.grid.getData(input);
      if (snapshot) {
        utils.reservation.grid.setData(
          input,
          relocateStay(snapshot, variables.stayId, variables.roomId)
        );
      }
      return { snapshot };
    },
    onError: (error, _variables, context) => {
      if (context?.snapshot) utils.reservation.grid.setData(input, context.snapshot);
      // In place, not as a toast: the answer is about the room under the
      // cursor, and it is read where the drag ended.
      const app = handleError(error, { toast: false });
      setRefusal(app?.message ?? t("grid.moveRefused"));
    },
    onSettled: () => {
      utils.reservation.grid.invalidate(input);
      utils.reservation.day.invalidate();
    },
  });

  const move = trpc.reservation.moveStay.useMutation({
    onMutate: async (variables) => {
      setRefusal(null);
      await utils.reservation.grid.cancel(input);
      const snapshot = utils.reservation.grid.getData(input);
      if (snapshot) {
        const moving = everyStay(snapshot).find((stay) => stay.id === variables.stayId);
        utils.reservation.grid.setData(
          input,
          rescheduleStay(
            snapshot,
            variables.stayId,
            { checkIn: asDate(variables.checkIn), checkOut: asDate(variables.checkOut) },
            variables.roomId === undefined ? (moving?.roomId ?? null) : variables.roomId
          )
        );
      }
      return { snapshot };
    },
    onError: (error, _variables, context) => {
      if (context?.snapshot) utils.reservation.grid.setData(input, context.snapshot);
      const app = handleError(error, { toast: false });
      setRefusal(app?.message ?? t("grid.moveRefused"));
    },
    onSettled: () => {
      utils.reservation.grid.invalidate(input);
      utils.reservation.day.invalidate();
    },
  });

  const setStatus = trpc.reservation.setStatus.useMutation({
    onMutate: () => setRefusal(null),
    onSuccess: (reservation) => {
      toast.success(`${label(reservation.status)} — ${reservation.reference}`);
    },
    onError: (error) => {
      const app = handleError(error, { toast: false });
      setRefusal(app?.message ?? t("grid.changeRefused"));
    },
    onSettled: () => {
      utils.reservation.grid.invalidate(input);
      utils.reservation.day.invalidate();
    },
  });

  const stayById = (id: number) =>
    [
      ...(data?.rooms.flatMap((row) => row.stays) ?? []),
      ...(data?.unassigned.flatMap((band) => band.stays) ?? []),
    ].find((stay) => stay.id === id);

  /**
   * A drop is one of two decisions, and which one is arithmetic.
   *
   * Landing on the night the chip was already on is a room change and nothing
   * more — `assignRoom`, which is cheaper and optimistic. Landing anywhere else
   * moves the dates, and the room travels with them in the same call so a
   * refused move cannot leave the booking in a room it was never given.
   */
  const drop = (roomId: number | null) => (column: number) => {
    if (!dragging) return;
    const stay = stayById(dragging.id);
    setDragging(null);
    if (!stay) return;

    const days = column - (stay.offset + dragging.grabNight);
    if (days === 0) {
      if (stay.roomId !== roomId) {
        assign.mutate({ propertyId, stayId: stay.id, roomId });
      }
      return;
    }

    move.mutate({
      propertyId,
      stayId: stay.id,
      checkIn: shiftDays(stay.checkIn, days),
      checkOut: shiftDays(stay.checkOut, days),
      roomId,
    });
  };

  /** An edge dragged on its own: one date moves, the other and the room stay. */
  const resize = (stay: GridStay, edge: "start" | "end", days: number) => {
    move.mutate({
      propertyId,
      stayId: stay.id,
      checkIn: edge === "start" ? shiftDays(stay.checkIn, days) : stay.checkIn,
      checkOut: edge === "end" ? shiftDays(stay.checkOut, days) : stay.checkOut,
    });
  };

  // A status belongs to the booking, not to one of its rooms, so acting on a
  // chip acts on the reservation behind it.
  const act = async (stay: GridStay, status: ReservationStatus) => {
    if (!(await confirmed(status))) return;
    setStatus.mutate({ propertyId, id: stay.reservationId, status });
  };

  const selected = data
    ? [
        ...data.rooms.flatMap((row) => row.stays.map((stay) => ({ stay, room: row.number }))),
        ...data.unassigned.flatMap((band) =>
          band.stays.map((stay) => ({ stay, room: null as string | null }))
        ),
      ].find((entry) => entry.stay.id === selectedId)
    : undefined;

  const nights = data?.window.nights ?? [];
  const width = `calc(${LABEL_WIDTH} + ${nights.length * NIGHT_WIDTH}rem)`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={t("grid.previousMonth")}
          onClick={() => setAnchor((current) => shiftMonths(current, -1))}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("grid.nextMonth")}
          onClick={() => setAnchor((current) => shiftMonths(current, 1))}
        >
          <ChevronRight />
        </Button>
        <Button variant="ghost" onClick={() => setAnchor(monthWindowOf(new Date()).from)}>
          {t("grid.today")}
        </Button>
        <span className="text-sm font-medium">{monthFormat.format(month.from)}</span>

        {/* The key to the marks. Without it the second cue is only decodable by
            someone who already knows what the colours mean. */}
        <ul className="text-muted-foreground ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {STATUS_LEGEND.map((status) => (
            <li key={status} className="flex items-center gap-1">
              <span
                aria-hidden
                className={cn(
                  "flex h-4 w-6 items-center justify-center rounded border text-[0.6rem]",
                  STATUS_CLASS[status]
                )}
              >
                {STATUS_MARK[status]}
              </span>
              {statusLabels[status]}
            </li>
          ))}
        </ul>
      </div>

      {selected && (
        <StayActions
          stay={selected.stay}
          today={today}
          roomNumber={selected.room}
          href={`/dashboard/orgs/${orgSlug}/front-desk/${propertySlug}/bookings/${selected.stay.publicId}`}
          pending={setStatus.isPending}
          onAct={(status) => act(selected.stay, status)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {refusal && (
        <p
          role="status"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded border px-3 py-2 text-sm"
        >
          {refusal}
        </p>
      )}

      {isLoading || !data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="overflow-x-auto rounded border">
          <div style={{ minWidth: width }}>
            <div className="bg-muted/60 flex border-b">
              <RowLabel className="bg-muted/60 font-medium">{t("grid.room")}</RowLabel>
              <NightArea nights={nights} lanes={1}>
                {nights.map((night, index) => (
                  <div
                    key={night.toISOString()}
                    style={{ gridColumn: index + 1, gridRow: 1 }}
                    className="z-10 flex flex-col items-center justify-center text-[0.65rem] leading-none"
                  >
                    <span className="text-muted-foreground">{weekdayFormat.format(night)}</span>
                    <span>{dayFormat.format(night)}</span>
                  </div>
                ))}
              </NightArea>
            </div>

            {data.roomTypes.map((type) => {
              const rooms = byType.rooms.get(type.id) ?? [];
              const band = byType.bands.get(type.id);
              if (rooms.length === 0 && !band) return null;

              return (
                <div key={type.id}>
                  <div className="bg-muted/30 flex border-b">
                    <RowLabel className="bg-muted/30 text-xs font-medium">
                      <span className="truncate">{type.name}</span>
                      {type.archivedAt && (
                        <span className="text-muted-foreground text-[0.65rem]">archived</span>
                      )}
                      {/* The key lives in the label column, one word per lane —
                          two bare numbers stacked in a cell say nothing. */}
                      <span
                        className="text-muted-foreground ml-auto flex flex-col items-end text-[0.6rem] font-normal"
                        style={{ lineHeight: LANE_HEIGHT }}
                      >
                        <span>{t("grid.sold")}</span>
                        <span>{t("grid.free")}</span>
                      </span>
                    </RowLabel>
                    <NightArea nights={nights} lanes={2}>
                      {nights.map((night, index) => {
                        const counts = byType.nightly.get(`${type.id}:${night.getTime()}`);
                        return (
                          <Fragment key={night.toISOString()}>
                            {/* Sold first: occupancy is the number a hotelier
                                watches, and free is what is left of it. */}
                            <div
                              style={{ gridColumn: index + 1, gridRow: 1 }}
                              className="z-10 flex items-center justify-center text-[0.65rem]"
                            >
                              {counts?.sold ?? "–"}
                            </div>
                            <div
                              style={{ gridColumn: index + 1, gridRow: 2 }}
                              className={cn(
                                "z-10 flex items-center justify-center text-[0.65rem]",
                                counts && counts.available === 0
                                  ? "text-destructive font-medium"
                                  : "text-muted-foreground"
                              )}
                            >
                              {counts?.available ?? "–"}
                            </div>
                          </Fragment>
                        );
                      })}
                    </NightArea>
                  </div>

                  {band && (
                    <div className="flex border-b bg-amber-50/60">
                      <RowLabel className="text-muted-foreground bg-amber-50/60 text-xs">
                        {t("grid.unassigned")}
                      </RowLabel>
                      <NightArea nights={nights} lanes={band.lanes} onDropStay={drop(null)}>
                        {band.stays.map((stay) => (
                          <StayChip
                            key={stay.id}
                            stay={stay}
                            onDragStart={(id, grabNight) => setDragging({ id, grabNight })}
                            onDragEnd={() => setDragging(null)}
                            onSelect={setSelectedId}
                            onResize={resize}
                            selected={stay.id === selectedId}
                            disabled={assign.isPending || move.isPending}
                          />
                        ))}
                      </NightArea>
                    </div>
                  )}

                  {rooms.map((room) => (
                    <div key={room.roomId} className="flex border-b last:border-b-0">
                      <RowLabel>
                        <span className="truncate font-medium">{room.number}</span>
                        {room.status !== RoomStatus.CLEAN && (
                          <span
                            className={cn(
                              "text-[0.65rem]",
                              room.status === RoomStatus.OUT_OF_ORDER
                                ? "text-destructive"
                                : "text-muted-foreground"
                            )}
                          >
                            {labels[room.status as RoomStatus] ?? room.status}
                          </span>
                        )}
                      </RowLabel>
                      <NightArea
                        nights={nights}
                        lanes={room.lanes}
                        onDropStay={drop(room.roomId)}
                        className={cn(
                          room.status === RoomStatus.OUT_OF_ORDER && "bg-destructive/5"
                        )}
                      >
                        {room.stays.map((stay) => (
                          <StayChip
                            key={stay.id}
                            stay={stay}
                            onDragStart={(id, grabNight) => setDragging({ id, grabNight })}
                            onDragEnd={() => setDragging(null)}
                            onSelect={setSelectedId}
                            onResize={resize}
                            selected={stay.id === selectedId}
                            disabled={assign.isPending || move.isPending}
                          />
                        ))}
                      </NightArea>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-muted-foreground text-xs">{t("grid.help")}</p>
    </div>
  );
}
