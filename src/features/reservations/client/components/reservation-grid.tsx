"use client";

import { useEnumLabels } from "@/lib/labels";
import { useLocale, useTranslations } from "next-intl";
import NiceModal from "@ebay/nice-modal-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronDown,
  ChevronsRight,
  CircleQuestionMark,
  Plus,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useErrorHandlers, useRefusalText } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { ROOM_STATUS_VALUES, RoomStatus } from "@/features/properties";
import {
  assignLanes,
  GRID_WINDOW_NIGHTS,
  laneCount,
  nextStatuses,
  refuseStatusChange,
  RESERVATION_STATUS_VALUES,
  ReservationStatus,
  fromDayInput,
  shiftStayDays,
  toDayInput,
  spanInWindow,
  todayAt,
  windowFrom,
  type GridWindowNights,
} from "@/features/reservations";
import { BookingFormNiceDialog } from "./booking-form-nice-dialog";
import { useBookingActions } from "../hooks/use-booking-actions";
import { DENSITY_VALUES, useDeskPreferences, type Density } from "../hooks/use-desk-preferences";
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

/** Matches the day lists: the two surfaces read the same stays. */
const GRID_REFRESH_MS = 30_000;

/**
 * The grid's three measurements, as custom properties rather than constants.
 *
 * A row, a label and a night are read by four components at three depths, and
 * threading a density through all of them is prop drilling for a number that
 * CSS already inherits. Set once on the scroll container, read with `var()`.
 *
 * `comfortable` is what the grid has always been, so nothing moves by default.
 * `compact` is the same screen for a property with forty rooms rather than
 * four — the reference trades days for no scroll, and this trades height.
 */
const DENSITY: Record<Density, { label: string; night: string; lane: string }> = {
  comfortable: { label: "10rem", night: "2.5rem", lane: "1.75rem" },
  compact: { label: "7rem", night: "1.75rem", lane: "1.25rem" },
};

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

/**
 * The grid's dates, in the reader's language.
 *
 * Built per locale rather than once at module scope: a formatter pinned to one
 * language is invisible to a language switch — the strings move and the dates
 * do not, which reads as a half-translated screen.
 *
 * **The window label is built from two `format()` calls, not `formatRange()`.**
 * `formatRange` is not stable across ICU versions — Node 24 separates the dash
 * with U+2009 THIN SPACE where Chrome uses an ordinary one, and U+202F before
 * Russian's "г." where Chrome uses a space — so the server and the browser
 * render the same words and React sees a hydration mismatch on every load of
 * the desk. `format()` was checked against a browser and agrees exactly.
 */
function useGridFormats() {
  const locale = useLocale();

  return useMemo(
    () => ({
      day: new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }),
      header: new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      month: new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }),
      range: new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
    }),
    [locale]
  );
}

const isWeekend = (date: Date) => date.getUTCDay() === 0 || date.getUTCDay() === 6;

/**
 * `<input type="date">` speaks `YYYY-MM-DD` and a stay date is UTC midnight, so
 * the two convert by their *fields*, never by their instant — east of Greenwich
 * an instant conversion lands on the day before, which is a desk jumping to the
 * wrong date and never knowing why.
 *
 * The native input rather than a calendar popover, deliberately: it costs no
 * bundle where `react-day-picker` cost this route 87 kB, it takes its first day
 * of the week and its own formatting from the reader's system rather than from
 * us, it is keyboard-reachable without any work — this screen's whole point —
 * and on a phone it opens the platform's picker, which is better than anything
 * we would draw. Looks are Phase 12's; this is the half that is not about
 * looks. The conversions are `toDayInput`/`fromDayInput` in `model/`.
 */

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
  uncommitted,
  disabled,
}: {
  stay: GridStay;
  onDragStart: (stayId: number, grabNight: number) => void;
  onDragEnd: () => void;
  onSelect: (stayId: number) => void;
  onResize: (stay: GridStay, edge: "start" | "end", days: number) => void;
  selected: boolean;
  /** Moved by the keyboard and not yet sent — `Enter` sends it. */
  uncommitted?: boolean;
  disabled: boolean;
}) {
  const statusLabels = useEnumLabels("reservationStatus", RESERVATION_STATUS_VALUES);
  const t = useTranslations("reservations");
  const formats = useGridFormats();
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
      // The chip's words, and the only place the status is said rather than
      // marked — `STATUS_MARK` is `aria-hidden` precisely because this is here.
      title={`${stay.reference} · ${statusLabels[stay.status as ReservationStatus] ?? stay.status} · ${formats.range.format(stay.checkIn)} → ${formats.range.format(stay.checkOut)} · ${t("list.nightCount", { nights })}`}
      className={cn(
        "relative z-10 mx-px flex items-center overflow-hidden rounded border px-1.5 text-xs whitespace-nowrap",
        "cursor-grab active:cursor-grabbing disabled:cursor-default",
        STATUS_CLASS[stay.status] ?? "border-border bg-card",
        // A clipped edge is not the real one, so it does not get a rounded cap.
        stay.continuesBefore && "rounded-l-none border-l-0",
        stay.continuesAfter && "rounded-r-none border-r-0",
        selected && "ring-ring ring-2 ring-offset-1",
        // A chip the keyboard moved looks exactly like one that was committed,
        // and the only difference that matters is whether it has been sent.
        uncommitted && "ring-ring ring-dashed border-dashed opacity-70 ring-2 ring-offset-1"
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
        gridTemplateColumns: `repeat(${nights.length}, minmax(var(--grid-night), 1fr))`,
        gridTemplateRows: `repeat(${Math.max(lanes, 1)}, var(--grid-lane))`,
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
  const formats = useGridFormats();
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
    <div
      role="group"
      aria-label={t("grid.selectedBooking")}
      // The label is for a person and changes with the language; this does not.
      // The locale journey switches languages as the thing under test, so it
      // needs one handle that survives the switch.
      data-testid="stay-actions"

      className="bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded border px-3 py-2"
    >
      <span className="text-sm font-medium">{stay.guestName ?? stay.reference}</span>
      <span className="text-muted-foreground text-xs">
        {stay.reference} · {statusLabels[stay.status as ReservationStatus]} ·{" "}
        {formats.range.format(stay.checkIn)} → {formats.range.format(stay.checkOut)} ·{" "}
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
      style={{ width: "var(--grid-label)" }}
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
  const formats = useGridFormats();
  const t = useTranslations("reservations");
  const { handleError } = useErrorHandlers();
  /**
   * Where the window starts. Today by default — a desk opening on the 28th
   * wants the days after it — and `?on=` when something sent the desk here to
   * look at a particular date, which is what the booking card's "show on the
   * grid" is. Read once, as the initial value: it is a starting point, not a
   * binding, so stepping away from it must not be undone by a re-render.
   */
  const searchParams = useSearchParams();
  const [anchor, setAnchor] = useState(
    () => fromDayInput(searchParams.get("on") ?? "") ?? todayAt(timezone)
  );
  const { preferences, update, toggleCollapsed } = useDeskPreferences(propertyId);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: number; grabNight: number } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** A keyboard change not yet sent — see `nudge` below. */
  const [pending, setPending] = useState<{
    stayId: number;
    checkIn: Date;
    checkOut: Date;
    roomId: number | null;
  } | null>(null);
  const today = useMemo(() => todayAt(timezone), [timezone]);

  const view = windowFrom(anchor, preferences.windowNights);
  const utils = trpc.useUtils();
  const input = { propertyId, from: view.from, to: view.to };

  const { data, isLoading } = trpc.reservation.grid.useQuery(input, {
    // Keep last month on screen while the next one loads; a grid that blanks
    // between clicks reads as broken.
    placeholderData: (previous) => previous,
    // Real-time, decided in Phase 4: polling rather than a subscription. See
    // the note in `front-desk-day.tsx`, which sets the interval.
    refetchInterval: GRID_REFRESH_MS,
  });

  /**
   * What is drawn: the server's answer, plus a keyboard change not yet sent.
   *
   * Through `rescheduleStay`, the same re-laning an optimistic drag uses — so a
   * previewed move lands in the right room, at the right lane, and a chip that
   * would overlap stacks rather than hiding what it covers.
   */
  const shown = useMemo(() => {
    if (!data || !pending) return data;
    return rescheduleStay(
      data,
      pending.stayId,
      { checkIn: pending.checkIn, checkOut: pending.checkOut },
      pending.roomId
    );
  }, [data, pending]);

  /**
   * The payload grouped once, rather than scanned per cell: the counts row asks
   * for a type and a night, and `find` over the whole availability array for
   * every one of them is the window's length times the number of types.
   */
  const byType = useMemo(() => {
    const rooms = new Map<number, Grid["rooms"]>();
    const bands = new Map<number, Grid["unassigned"][number]>();
    const nightly = new Map<string, Grid["availability"][number]>();

    for (const room of shown?.rooms ?? []) {
      const drawn = rooms.get(room.roomTypeId);
      if (drawn) drawn.push(room);
      else rooms.set(room.roomTypeId, [room]);
    }
    for (const band of shown?.unassigned ?? []) bands.set(band.roomTypeId, band);
    for (const row of shown?.availability ?? []) {
      nightly.set(`${row.roomTypeId}:${row.date.getTime()}`, row);
    }

    return { rooms, bands, nightly };
  }, [shown]);

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

  // Memoised because the keyboard handler closes over it: recreated each
  // render, it would rebind the window listener on every keystroke.
  const stayById = useCallback(
    (id: number) =>
      [
        ...(data?.rooms.flatMap((row) => row.stays) ?? []),
        ...(data?.unassigned.flatMap((band) => band.stays) ?? []),
      ].find((stay) => stay.id === id),
    [data]
  );

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
      checkIn: shiftStayDays(stay.checkIn, days),
      checkOut: shiftStayDays(stay.checkOut, days),
      roomId,
    });
  };

  /** An edge dragged on its own: one date moves, the other and the room stay. */
  const resize = (stay: GridStay, edge: "start" | "end", days: number) => {
    move.mutate({
      propertyId,
      stayId: stay.id,
      checkIn: edge === "start" ? shiftStayDays(stay.checkIn, days) : stay.checkIn,
      checkOut: edge === "end" ? shiftStayDays(stay.checkOut, days) : stay.checkOut,
    });
  };

  // A status belongs to the booking, not to one of its rooms, so acting on a
  // chip acts on the reservation behind it.
  /**
   * The three gestures, without a mouse.
   *
   * Assignment, moving and resizing were drag-only, and a desk that works fast
   * works on a keyboard. Arrows build a *pending* change rather than sending
   * one per keypress — a drag is one mutation for the whole gesture and this
   * has to be too, or holding an arrow for five nights is five refusals in a
   * row. `Enter` sends it, `Escape` puts it back.
   */
  /**
   * Every row a stay can land on, in the order they are drawn: each type's
   * unassigned band, then its rooms. Up and down step through this, so the
   * keyboard reaches the band exactly as a drag does.
   */
  const targets = useMemo(() => {
    const rows: { roomId: number | null; roomTypeId: number }[] = [];
    for (const type of data?.roomTypes ?? []) {
      rows.push({ roomId: null, roomTypeId: type.id });
      for (const room of byType.rooms.get(type.id) ?? []) {
        rows.push({ roomId: room.roomId, roomTypeId: type.id });
      }
    }
    return rows;
  }, [data, byType]);

  const nudge = useCallback(
    (event: KeyboardEvent) => {
      if (selectedId === null) return;
      const stay = pending ? { ...stayById(selectedId), ...pending } : stayById(selectedId);
      if (!stay?.id) return;

      const from = pending ?? {
        stayId: selectedId,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        roomId: stay.roomId,
      };

      const step = (days: number, edge: boolean) =>
        setPending({
          ...from,
          checkIn: edge ? from.checkIn : shiftStayDays(from.checkIn, days),
          checkOut: shiftStayDays(from.checkOut, days),
        });

      const row = (delta: number) => {
        // Only within the stay's own type: a room of another category is a
        // different thing sold, not a different row.
        const own = targets.filter((target) => target.roomTypeId === stay.roomTypeId);
        const at = own.findIndex((target) => target.roomId === from.roomId);
        const next = own[Math.min(Math.max(at + delta, 0), own.length - 1)];
        if (next) setPending({ ...from, roomId: next.roomId });
      };

      switch (event.key) {
        case "ArrowLeft":
          step(-1, event.shiftKey);
          break;
        case "ArrowRight":
          step(1, event.shiftKey);
          break;
        case "ArrowUp":
          row(-1);
          break;
        case "ArrowDown":
          row(1);
          break;
        case "Enter":
          if (pending) {
            move.mutate({
              propertyId,
              stayId: pending.stayId,
              checkIn: pending.checkIn,
              checkOut: pending.checkOut,
              roomId: pending.roomId,
            });
            setPending(null);
          }
          return;
        case "Escape":
          // One press undoes the pending change, a second lets the chip go.
          if (pending) setPending(null);
          else setSelectedId(null);
          return;
        default:
          return;
      }

      // Only now: a key this does not handle must still scroll the page.
      event.preventDefault();
    },
    [selectedId, pending, targets, move, propertyId, stayById]
  );

  useEffect(() => {
    if (selectedId === null) return;
    window.addEventListener("keydown", nudge);
    return () => window.removeEventListener("keydown", nudge);
  }, [selectedId, nudge]);

  // A selection that goes away takes its half-made change with it.
  useEffect(() => {
    if (selectedId === null) setPending(null);
  }, [selectedId]);

  const act = async (stay: GridStay, status: ReservationStatus) => {
    if (!(await confirmed(status))) return;
    setStatus.mutate({ propertyId, id: stay.reservationId, status });
  };

  const selected = shown
    ? [
        ...shown.rooms.flatMap((row) => row.stays.map((stay) => ({ stay, room: row.number }))),
        ...shown.unassigned.flatMap((band) =>
          band.stays.map((stay) => ({ stay, room: null as string | null }))
        ),
      ].find((entry) => entry.stay.id === selectedId)
    : undefined;

  const nights = shown?.window.nights ?? [];
  const width = `calc(var(--grid-label) + ${nights.length} * var(--grid-night))`;
  const lastNight = shiftStayDays(view.to, -1);
  /**
   * Collapsed inside one month, spelled out when the window crosses one — the
   * behaviour `formatRange` gave, assembled from calls that hydrate.
   */
  const windowLabel =
    view.from.getUTCMonth() === lastNight.getUTCMonth() &&
    view.from.getUTCFullYear() === lastNight.getUTCFullYear()
      ? formats.header.format(view.from)
      : `${formats.month.format(view.from)} – ${formats.header.format(lastNight)}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={t("grid.previousWeek")}
          onClick={() => setAnchor((current) => shiftStayDays(current, -7))}
        >
          <ChevronsLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("grid.previousDay")}
          onClick={() => setAnchor((current) => shiftStayDays(current, -1))}
        >
          <ChevronLeft />
        </Button>
        <Button variant="ghost" onClick={() => setAnchor(todayAt(timezone))}>
          {t("grid.today")}
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("grid.nextDay")}
          onClick={() => setAnchor((current) => shiftStayDays(current, 1))}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("grid.nextWeek")}
          onClick={() => setAnchor((current) => shiftStayDays(current, 7))}
        >
          <ChevronsRight />
        </Button>

        {/* Reaching next March was eleven clicks. The window is an anchor now,
            so it can simply be said. */}
        <Input
          type="date"
          aria-label={t("grid.jumpToDate")}
          className="h-8 w-40"
          value={toDayInput(anchor)}
          onChange={(event) => {
            const picked = fromDayInput(event.target.value);
            if (picked) setAnchor(picked);
          }}
        />
        <span className="text-sm font-medium">{windowLabel}</span>

        <Select
          value={String(preferences.windowNights)}
          onValueChange={(value) => update({ windowNights: Number(value) as GridWindowNights })}
        >
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GRID_WINDOW_NIGHTS.map((length) => (
              <SelectItem key={length} value={String(length)}>
                {t("grid.nightsOption", { nights: length })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={preferences.density}
          onValueChange={(value) => update({ density: value as Density })}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DENSITY_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(value === "compact" ? "grid.densityCompact" : "grid.densityComfortable")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* The walk-in beside this books tonight. This is every other
            booking — the only path to a date that is not today. */}
        <Button
          size="sm"
          onClick={() => NiceModal.show(BookingFormNiceDialog, { propertyId, timezone })}
        >
          <Plus />
          {t("booking.title")}
        </Button>

        {/* The grid is bounded by its window, so a guest ringing about next
            March cannot be found on it at all. That question has its own
            screen; this is the way to it. */}
        <Button
          nativeButton={false}
          variant="outline"
          size="sm"
          render={<Link href={`/dashboard/orgs/${orgSlug}/front-desk/${propertySlug}/bookings`} />}
        >
          <Search />
          {t("grid.findBooking")}
        </Button>

        {/* Two paragraphs of instructions permanently under a screen read for
            eight hours is clutter after the first day; the same words one click
            away are there when a new receptionist needs them. */}
        <Popover>
          <PopoverTrigger
            render={<Button variant="ghost" size="icon" aria-label={t("grid.howToUse")} />}
          >
            <CircleQuestionMark />
          </PopoverTrigger>
          <PopoverContent align="start" className="max-w-sm space-y-2 text-xs">
            <p>{t("grid.help")}</p>
            <p>{t("grid.keyboardHint")}</p>
          </PopoverContent>
        </Popover>

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

      {isLoading || !shown ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div
          className="overflow-x-auto rounded border"
          style={
            {
              "--grid-label": DENSITY[preferences.density].label,
              "--grid-night": DENSITY[preferences.density].night,
              "--grid-lane": DENSITY[preferences.density].lane,
            } as CSSProperties
          }
        >
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
                    <span className="text-muted-foreground">{formats.weekday.format(night)}</span>
                    <span>{formats.day.format(night)}</span>
                  </div>
                ))}
              </NightArea>
            </div>

            {shown.roomTypes.map((type) => {
              const rooms = byType.rooms.get(type.id) ?? [];
              const band = byType.bands.get(type.id);
              if (rooms.length === 0 && !band) return null;

              // Three categories do not need this; twenty are the difference
              // between a screen and a scroll. The counts row stays either way
              // — it is the answer a collapsed category is kept open for.
              const collapsed = preferences.collapsed.includes(type.id);

              return (
                <div key={type.id}>
                  <div className="bg-muted/30 flex border-b">
                    <RowLabel className="bg-muted/30 text-xs font-medium">
                      <button
                        type="button"
                        onClick={() => toggleCollapsed(type.id)}
                        aria-expanded={!collapsed}
                        aria-label={collapsed ? t("grid.expandType") : t("grid.collapseType")}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                      >
                        {collapsed ? (
                          <ChevronRight className="size-3.5" />
                        ) : (
                          <ChevronDown className="size-3.5" />
                        )}
                      </button>
                      <span className="truncate">{type.name}</span>
                      {type.archivedAt && (
                        <span className="text-muted-foreground text-[0.65rem]">archived</span>
                      )}
                      {/* The key lives in the label column, one word per lane —
                          two bare numbers stacked in a cell say nothing. */}
                      <span
                        className="text-muted-foreground ml-auto flex flex-col items-end text-[0.6rem] font-normal"
                        style={{ lineHeight: "var(--grid-lane)" }}
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

                  {!collapsed && band && (
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
                            uncommitted={pending?.stayId === stay.id}
                            disabled={assign.isPending || move.isPending}
                          />
                        ))}
                      </NightArea>
                    </div>
                  )}

                  {!collapsed &&
                    rooms.map((room) => (
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
                              uncommitted={pending?.stayId === stay.id}
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
    </div>
  );
}
