import { z } from "zod";
import { stayDateSchema } from "./schemas";
import { toStayDate, type StayRange } from "./stay";

/**
 * The desk's day. A stay touches it as an arrival, a departure, or a night in
 * between — which list it belongs to is arithmetic on two dates rather than a
 * column, so the three lists cannot disagree with the grid drawn from the same
 * rows.
 */

export const DayRole = {
  ARRIVAL: "ARRIVAL",
  DEPARTURE: "DEPARTURE",
  IN_HOUSE: "IN_HOUSE",
} as const;

export type DayRole = (typeof DayRole)[keyof typeof DayRole];

export const DAY_ROLE_LABELS: Record<DayRole, string> = {
  ARRIVAL: "Arrivals",
  DEPARTURE: "Departures",
  IN_HOUSE: "In house",
};

/**
 * Which list a stay belongs to on `day`, or `null` when it does not touch it.
 *
 * Half-open everywhere else, and deliberately not here: the departure day is
 * not a night, but it is the morning's work, so a stay of 3rd→4th appears on
 * the 3rd as an arrival and on the 4th as a departure. The roles are exclusive
 * because a stay is at least one night — arriving and leaving on one day is
 * not a range this system can hold.
 */
export function dayRoleOf(range: StayRange, day: Date): DayRole | null {
  const at = toStayDate(day).getTime();
  const checkIn = toStayDate(range.checkIn).getTime();
  const checkOut = toStayDate(range.checkOut).getTime();

  if (checkIn === at) return DayRole.ARRIVAL;
  if (checkOut === at) return DayRole.DEPARTURE;
  if (checkIn < at && at < checkOut) return DayRole.IN_HOUSE;
  return null;
}

export const frontDeskDaySchema = z.object({
  propertyId: z.number(),
  day: stayDateSchema,
});

export type FrontDeskDayInput = z.infer<typeof frontDeskDaySchema>;
