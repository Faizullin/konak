import { z } from "zod";
import { toStayDate } from "./stay";

/**
 * Reservation state, as a machine. The column is a string; these values and the
 * transitions below are what actually constrain it.
 */
export const ReservationStatus = {
  ENQUIRY: "ENQUIRY",
  CONFIRMED: "CONFIRMED",
  CHECKED_IN: "CHECKED_IN",
  CHECKED_OUT: "CHECKED_OUT",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
} as const;

export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus];

export const RESERVATION_STATUS_VALUES = Object.values(ReservationStatus);

export const reservationStatusSchema = z.enum(RESERVATION_STATUS_VALUES);

/** What a person sees. One definition, so the grid and a detail panel agree. */
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  ENQUIRY: "Enquiry",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  CHECKED_OUT: "Checked out",
  CANCELLED: "Cancelled",
  NO_SHOW: "No show",
};

/**
 * What may follow what. A stay moves forward or it ends; nothing returns to an
 * earlier state, because the side effects — inventory, folio, keycard,
 * housekeeping — are not reversible by flipping a column back.
 *
 * Undoing a mistake is a new decision with its own record, not a transition.
 */
const TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  [ReservationStatus.ENQUIRY]: [ReservationStatus.CONFIRMED, ReservationStatus.CANCELLED],
  [ReservationStatus.CONFIRMED]: [
    ReservationStatus.CHECKED_IN,
    ReservationStatus.CANCELLED,
    ReservationStatus.NO_SHOW,
  ],
  [ReservationStatus.CHECKED_IN]: [ReservationStatus.CHECKED_OUT],
  [ReservationStatus.CHECKED_OUT]: [],
  [ReservationStatus.CANCELLED]: [],
  [ReservationStatus.NO_SHOW]: [],
};

/** An unrecognised status answers `false` rather than throwing: the column is a string. */
export function canTransition(from: string, to: string): boolean {
  const allowed = TRANSITIONS[from as ReservationStatus];
  return allowed ? allowed.includes(to as ReservationStatus) : false;
}

export function nextStatuses(from: string): readonly ReservationStatus[] {
  return TRANSITIONS[from as ReservationStatus] ?? [];
}

export function isTerminal(status: string): boolean {
  return nextStatuses(status).length === 0 && status in TRANSITIONS;
}

const spoken = (status: string) =>
  (RESERVATION_STATUS_LABELS[status as ReservationStatus] ?? status).toLowerCase();

const arrivalFormat = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export type StatusChange = {
  from: string;
  to: string;
  /** Every stay on the booking: a reservation may hold more than one room. */
  stays: readonly { roomId: number | null; checkIn: Date; checkOut: Date }[];
  /** The property's day, not the server's — `todayAt` in `stay.ts`. */
  today: Date;
};

/**
 * Why the desk may not make this change, or `null`.
 *
 * The machine above says what may follow what; this adds what the front desk
 * needs to also be true, and returns the sentence rather than a boolean so the
 * disabled button and the server's refusal say the same thing.
 *
 * Checking in is where a booking stops being a room type and becomes a room, so
 * an unassigned stay is refused here rather than checked in to nothing. The
 * date rules exist because a booking that has not arrived yet is wrong dates,
 * not an early arrival — and moving dates is its own decision.
 */
export function refuseStatusChange({ from, to, stays, today }: StatusChange): string | null {
  if (!canTransition(from, to)) {
    return `A ${spoken(from)} reservation cannot become ${spoken(to)}`;
  }

  // A booking arrives when its earliest stay does and ends when its last one
  // does, so the rules read the whole reservation.
  const dates = stays.map((stay) => toStayDate(stay.checkIn).getTime());
  const ends = stays.map((stay) => toStayDate(stay.checkOut).getTime());
  const arrival = dates.length > 0 ? new Date(Math.min(...dates)) : null;
  const departure = ends.length > 0 ? new Date(Math.max(...ends)) : null;

  if (to === ReservationStatus.CHECKED_IN && stays.some((stay) => stay.roomId === null)) {
    return "Assign a room first — a guest checks into a room, not into a room type";
  }

  if (
    arrival &&
    arrival > today &&
    (to === ReservationStatus.CHECKED_IN || to === ReservationStatus.NO_SHOW)
  ) {
    return `That booking arrives on ${arrivalFormat.format(arrival)}, so it cannot ${
      to === ReservationStatus.CHECKED_IN ? "check in" : "be a no-show"
    } today — move the dates instead`;
  }

  // A no-show can still be recorded late; a check-in cannot, because there is
  // no night left to check into.
  if (to === ReservationStatus.CHECKED_IN && departure && departure <= today) {
    return "That booking's last night has passed";
  }

  return null;
}

/**
 * Whether a reservation in this state occupies its rooms.
 *
 * This is the definition availability is computed from, so it decides what can
 * be sold. `CHECKED_OUT` still counts: the guest did occupy those nights, and a
 * past date must not read as free. An `ENQUIRY` is a quote and holds nothing —
 * a hold is `InventoryHold`, with an expiry.
 */
export function occupiesInventory(status: string): boolean {
  return (
    status === ReservationStatus.CONFIRMED ||
    status === ReservationStatus.CHECKED_IN ||
    status === ReservationStatus.CHECKED_OUT
  );
}
