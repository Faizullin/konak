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
 * The month a date falls in, as a window. The grid moves a month at a time, and
 * a month is what `GRID_MAX_NIGHTS` was sized for.
 */
export function monthWindowOf(anchor: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
  return { from, to };
}

/** December + 1 is January, which `Date.UTC` already knows. */
export function shiftMonths(anchor: Date, months: number): Date {
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, 1));
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
