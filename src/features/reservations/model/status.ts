import { z } from "zod";

/**
 * Reservation state, as a machine. The column is a string because SQLite has no
 * enum; these values and the transitions below are what actually constrain it.
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
