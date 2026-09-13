import { z } from "zod";
import { stayDateSchema } from "./schemas";
import { ReservationStatus } from "./status";
import { nightsBetween, toStayDate, type StayRange } from "./stay";

/**
 * The grid's geometry. Rooms down, dates across, and a stay is a span rather
 * than a row — so where a booking is drawn is arithmetic on the window, and a
 * wrong answer here is visible without a database.
 */

/**
 * Two months. The screen shows one; a drag towards either edge wants the next
 * few days already loaded. The cap exists because the window is what bounds the
 * query — without it one request asks for a year of every room.
 */
export const GRID_MAX_NIGHTS = 62;

export const gridWindowSchema = z.object({
  propertyId: z.number(),
  from: stayDateSchema,
  to: stayDateSchema,
});

export type GridWindowInput = z.infer<typeof gridWindowSchema>;

/** The window as the grid counts it: a first night and how many columns follow. */
export type GridWindow = { from: Date; nights: number };

/**
 * `null` when the range is not a window a grid can draw — no nights, or more
 * than the cap. The caller turns that into a refusal; this stays pure.
 */
export function gridWindowOf(from: Date, to: Date): GridWindow | null {
  const nights = nightsBetween(from, to);
  if (nights < 1 || nights > GRID_MAX_NIGHTS) return null;
  return { from: toStayDate(from), nights };
}

/**
 * The lengths the desk may choose, in nights.
 *
 * A fortnight reads without scrolling on a laptop, a month is what the row
 * heights were sized for, and the cap is the cap — it is what bounds the query,
 * so nothing above it can be offered.
 */
export const GRID_WINDOW_NIGHTS = [14, 31, GRID_MAX_NIGHTS] as const;

export type GridWindowNights = (typeof GRID_WINDOW_NIGHTS)[number];

export const DEFAULT_WINDOW_NIGHTS: GridWindowNights = 31;

/**
 * A window of `nights` beginning on `anchor`.
 *
 * **The calendar month is not the unit.** A month always begins on the 1st, so
 * a stay crossing a boundary is cut by the view rather than drawn whole — and
 * the last week of a month is exactly when a desk needs to see the days after
 * it. An anchor and a length have neither problem.
 *
 * The length is clamped rather than refused: it comes from a control with a
 * fixed set of options, and there is no screen state for a window of no nights.
 */
export function windowFrom(anchor: Date, nights: number): { from: Date; to: Date } {
  const length = Math.min(Math.max(Math.trunc(nights) || 1, 1), GRID_MAX_NIGHTS);
  const from = toStayDate(anchor);
  return { from, to: shiftStayDays(from, length) };
}

/**
 * A whole number of days from a stay date, which stays a stay date.
 *
 * Added as a field rather than as milliseconds: the end of a month and the end
 * of a year are `Date.UTC`'s problem, not this function's.
 */
export function shiftStayDays(date: Date, days: number): Date {
  const day = toStayDate(date);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + days));
}

export type GridSpan = {
  /** Column of the first night drawn, 0-based inside the window. */
  offset: number;
  /** Columns covered, at least one. */
  nights: number;
  /**
   * The stay begins before the window, or ends after it. The drawn edge is not
   * the real one, and an edge that is not real must not be a resize handle.
   */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/**
 * Where a stay sits in the window, clipped to it. `null` when it misses the
 * window entirely — half-open, so a stay departing on the first column touches
 * nothing and is not drawn.
 */
export function spanInWindow(range: StayRange, window: GridWindow): GridSpan | null {
  const start = nightsBetween(window.from, range.checkIn);
  const end = nightsBetween(window.from, range.checkOut);

  const offset = Math.max(0, start);
  const until = Math.min(window.nights, end);
  if (until <= offset) return null;

  return {
    offset,
    nights: until - offset,
    continuesBefore: start < 0,
    continuesAfter: end > window.nights,
  };
}

export type Laned<T> = T & { lane: number };

/**
 * Stack spans that share a column instead of drawing one over the other.
 *
 * A room's *confirmed* stays cannot overlap — the exclusion constraint refuses
 * it — but an enquiry holds nothing and is not constrained, and the band of
 * unassigned stays for a room type overlaps constantly. So a row is one or more
 * lanes, and its height is `max(lane) + 1`.
 */
export function assignLanes<T extends GridSpan>(spans: T[]): Laned<T>[] {
  // First free column per lane, so a departure and an arrival on the same day
  // share a lane — the same half-open comparison the constraint makes.
  const nextFree: number[] = [];

  return spans
    .toSorted((a, b) => a.offset - b.offset || a.nights - b.nights)
    .map((span) => {
      let lane = nextFree.findIndex((free) => free <= span.offset);
      if (lane === -1) lane = nextFree.length;
      nextFree[lane] = span.offset + span.nights;
      return { ...span, lane };
    });
}

/** How many lanes a row needs to draw all of its spans. */
export function laneCount(spans: Laned<GridSpan>[]): number {
  return spans.reduce((height, span) => Math.max(height, span.lane + 1), 0);
}

/**
 * What the grid leaves out. Cancelled and no-show released the room, and drawing
 * them would say a free room is taken.
 *
 * An exclusion rather than a list of what to draw, which is the opposite
 * direction to `isRoomSellable` and deliberately so — the dangerous failure here
 * is hiding a booking that exists, not showing one too many. It is also the
 * `where` the query filters by, so the screen and the query cannot disagree.
 */
export const GRID_HIDDEN_STATUSES: readonly string[] = [
  ReservationStatus.CANCELLED,
  ReservationStatus.NO_SHOW,
];

export function appearsOnGrid(status: string): boolean {
  return !GRID_HIDDEN_STATUSES.includes(status);
}

/**
 * Which column a day sits in, or `null` when it is outside the window.
 *
 * What the grid needs to draw a line down today: the window is an anchor and a
 * length, so this is a subtraction, and it is here rather than in the component
 * because being one column out is a line pointing at the wrong day.
 */
export function columnOf(day: Date, window: GridWindow): number | null {
  const offset = nightsBetween(window.from, day);
  return offset >= 0 && offset < window.nights ? offset : null;
}

/**
 * How a single night in one room is occupied.
 *
 * The case that matters is `turnover`: one guest leaves on the morning a
 * another arrives in the afternoon. Half-open dates already say this correctly
 * — the departing stay's `checkOut` equals the arriving stay's `checkIn`, so
 * neither holds the night and the exclusion constraint permits both — but the
 * *drawing* has always shown two chips side by side, where every Russian PMS
 * splits the cell on the diagonal.
 *
 * `out` is the stay that leaves that morning, `in` the one that arrives. Either
 * may be absent; both absent is a free night and answers `null`.
 */
export type NightOccupancy = {
  kind: "single" | "turnover";
  /** The stay departing on this day, if one does. */
  out: number | null;
  /** The stay arriving on this day, if one does. */
  in: number | null;
};

export function occupancyOf(
  day: Date,
  stays: readonly (StayRange & { id: number })[]
): NightOccupancy | null {
  const at = toStayDate(day).getTime();

  let leaving: number | null = null;
  let arriving: number | null = null;
  let staying: number | null = null;

  for (const stay of stays) {
    const from = toStayDate(stay.checkIn).getTime();
    const to = toStayDate(stay.checkOut).getTime();

    // The departure day is not a night, so a stay ending here is *leaving* it
    // rather than occupying it — which is exactly what makes the turnover legal.
    if (to === at) leaving = stay.id;
    else if (from === at) arriving = stay.id;
    else if (from < at && to > at) staying = stay.id;
  }

  if (leaving !== null && arriving !== null) {
    return { kind: "turnover", out: leaving, in: arriving };
  }
  if (arriving !== null) return { kind: "single", out: null, in: arriving };
  if (staying !== null) return { kind: "single", out: null, in: staying };
  // A departure with nobody arriving leaves the night free: the room is
  // available from that morning, which is the whole point of half-open.
  return null;
}
