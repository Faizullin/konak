import { z } from "zod";
import { stayDateSchema } from "./schemas";
import { RESERVATION_STATUS_VALUES, ReservationStatus, reservationStatusSchema } from "./status";

/**
 * Finding a booking when the dates are not known.
 *
 * The grid answers "what is happening on these nights". This answers "where is
 * the booking for the person on the phone", which is the other half of a desk's
 * day and the one the grid cannot do.
 */

/**
 * The three tabs, as a **partition** of the six states.
 *
 * A partition rather than three independent filters: every booking is in
 * exactly one tab, so a desk working down them cannot miss one and cannot meet
 * the same one twice. The test holds it to that.
 */
export const BookingView = {
  /** Asked for and not yet sold. */
  NEW: "NEW",
  /** Sold, or in the building. */
  CURRENT: "CURRENT",
  /** Over, one way or another. */
  ARCHIVE: "ARCHIVE",
} as const;

export type BookingView = (typeof BookingView)[keyof typeof BookingView];

export const BOOKING_VIEW_VALUES = Object.values(BookingView);

export const bookingViewSchema = z.enum(BOOKING_VIEW_VALUES);

const VIEW_STATUSES: Record<BookingView, readonly ReservationStatus[]> = {
  [BookingView.NEW]: [ReservationStatus.ENQUIRY],
  [BookingView.CURRENT]: [ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN],
  [BookingView.ARCHIVE]: [
    ReservationStatus.CHECKED_OUT,
    ReservationStatus.CANCELLED,
    ReservationStatus.NO_SHOW,
  ],
};

/** An unrecognised view is every status rather than none: a bad tab shows too much, never too little. */
export function statusesInView(view: string): readonly ReservationStatus[] {
  return VIEW_STATUSES[view as BookingView] ?? RESERVATION_STATUS_VALUES;
}

/**
 * How many words one search may carry.
 *
 * Each word becomes its own `OR` across four relations, so an unbounded term is
 * an unbounded query. Four is a full name plus a room number.
 */
export const SEARCH_TERM_LIMIT = 4;

/**
 * A typed search, split into the words that must *all* match something.
 *
 * "Ada Lovelace" is two words against two columns, and requiring both is what
 * stops it matching every other Ada. A room number and a reference are one word
 * each and fall out of the same rule.
 */
export function searchTerms(search: string): string[] {
  return search.trim().split(/\s+/).filter(Boolean).slice(0, SEARCH_TERM_LIMIT);
}

/**
 * Reservation columns only. A stay's arrival lives on the other side of a
 * to-many, and offering a sort the database cannot make is worse than not
 * offering it.
 */
export const RESERVATION_SORT_FIELDS = ["bookedAt", "reference", "status"] as const;

export const listReservationsSchema = z.object({
  propertyId: z.number(),
  filter: z
    .object({
      /** One term for the guest, the room and the reference — a desk knows one of the three. */
      search: z.string().max(200).optional(),
      view: bookingViewSchema.optional(),
      status: z.array(reservationStatusSchema).optional(),
      roomTypeId: z.number().optional(),
      /** Bookings touching these nights, the same half-open comparison the grid makes. */
      from: stayDateSchema.optional(),
      to: stayDateSchema.optional(),
    })
    .optional(),
  orderBy: z
    .object({
      field: z.enum(RESERVATION_SORT_FIELDS),
      direction: z.enum(["asc", "desc"]),
    })
    .optional(),
  pagination: z.object({
    skip: z.number().min(0).default(0),
    take: z.number().min(1).max(100).default(10),
  }),
});

export type ListReservationsInput = z.infer<typeof listReservationsSchema>;
