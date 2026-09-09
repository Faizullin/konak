/**
 * What this feature refuses, as codes rather than sentences.
 *
 * A message is written for a person and will be reworded, and eventually
 * translated. A code is what survives that: a test asserts on it, a screen
 * branches on it, and a translation file keys on it. The server throws these
 * through `DomainError`; the client reads them back as `AppError.domainCode`.
 *
 * In `model/` because both sides need the same constant — the router that
 * throws it and the component that recognises it.
 */
export const ReservationError = {
  NOT_FOUND: "reservation.not_found",
  /** `refuseStatusChange` said no. The sentence travels with it. */
  STATUS_REFUSED: "reservation.status_refused",

  STAY_NOT_FOUND: "stay.not_found",
  /** Zero nights, however the dates arrived at it. */
  STAY_TOO_SHORT: "stay.too_short",
  /** More guests than the room type sleeps. */
  STAY_OVER_OCCUPANCY: "stay.over_occupancy",
  /** No room of that type free on some night in the range. */
  STAY_SOLD_OUT: "stay.sold_out",
  /** A hold asked for more rooms than are free that night. */
  HOLD_SHORT: "hold.short",
  /** The rate plan quoted nothing, or refused these dates. */
  STAY_NO_PRICE: "stay.no_price",
  /** `refuseStayMove` said no. */
  STAY_MOVE_REFUSED: "stay.move_refused",
  /** A range that is not one or more nights. */
  STAY_RANGE_INVALID: "stay.range_invalid",

  ROOM_NOT_FOUND: "room.not_found",
  ROOM_TYPE_NOT_FOUND: "room_type.not_found",
  /** The room is of a different type than the stay was sold as. */
  ROOM_WRONG_TYPE: "room.wrong_type",
  /** The exclusion constraint refused it: someone is already in there. */
  ROOM_TAKEN: "room.taken",
  /** Out of order, so it cannot hold a guest however free it looks. */
  ROOM_NOT_SELLABLE: "room.not_sellable",

  /** A window the grid cannot draw — no nights, or more than the cap. */
  GRID_WINDOW_INVALID: "grid.window_invalid",
  /** No `NumberSeries` row to take a reference from. */
  SERIES_MISSING: "series.missing",
} as const;

export type ReservationError = (typeof ReservationError)[keyof typeof ReservationError];

export const RESERVATION_ERROR_CODES = Object.values(ReservationError);
