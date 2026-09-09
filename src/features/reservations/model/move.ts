import type { Refused } from "@/lib/refusal";
import { ReservationError } from "./errors";
import { isValidStayRange, toStayDate, type StayRange } from "./stay";
import { isTerminal, ReservationStatus } from "./status";

/**
 * Moving a stay's dates — the other half of a drag.
 *
 * `assignRoom` answers "which room"; this answers "which nights", and it is a
 * decision with rules rather than a field update. Same shape as
 * `refuseStatusChange`: the sentence is the return value, so the disabled edge
 * and the server's refusal cannot say different things.
 */

export type StayMove = {
  /** The stay's own status, which is what the overlap constraint reads. */
  status: string;
  from: StayRange;
  to: StayRange;
  /** The property's day, not the server's — `todayAt` in `stay.ts`. */
  today: Date;
};

/**
 * Why the desk may not move this stay there, or `null`.
 *
 * The overlap itself is not checked here — that is the exclusion constraint's
 * answer, and it is the only one that is actually true under concurrency. What
 * this holds is what the constraint cannot know: that a guest who has already
 * arrived did arrive on the day they arrived, and that a booking is not moved
 * to nights that have already gone.
 */
export function refuseStayMove({ status, from, to, today }: StayMove): Refused {
  if (!isValidStayRange(to)) {
    return { code: ReservationError.STAY_TOO_SHORT, message: "A stay is at least one night" };
  }

  if (isTerminal(status)) {
    return {
      code: ReservationError.STAY_DATES_LOCKED,
      values: { status },
      message: "That booking has ended, so its dates cannot move",
    };
  }

  const day = toStayDate(today).getTime();
  const arrived = toStayDate(from.checkIn).getTime();
  const arriving = toStayDate(to.checkIn).getTime();
  const leaving = toStayDate(to.checkOut).getTime();

  if (status === ReservationStatus.CHECKED_IN) {
    // The arrival is a fact once it has happened. Correcting it is a different
    // decision with its own record, the same way an undone status is.
    if (arriving !== arrived) {
      return {
        code: ReservationError.STAY_ARRIVAL_FIXED,
        message: "The guest has already arrived",
      };
    }
    if (leaving < day) {
      return {
        code: ReservationError.STAY_ENDS_BEFORE_TODAY,
        message: "That would end the stay before today",
      };
    }
    return null;
  }

  if (arriving < day) {
    return { code: ReservationError.STAY_MOVED_INTO_PAST, message: "Those nights have passed" };
  }

  return null;
}

/**
 * The nights `to` adds that `from` did not already hold.
 *
 * Availability counts this stay against itself, so extending by one night must
 * only ask about that night — checking the whole new range would find the stay
 * already there and refuse its own move.
 */
export function addedNights(from: StayRange, to: StayRange): Date[] {
  const held = new Set<number>();
  for (
    let t = toStayDate(from.checkIn).getTime();
    t < toStayDate(from.checkOut).getTime();
    t += 86_400_000
  ) {
    held.add(t);
  }

  const added: Date[] = [];
  for (
    let t = toStayDate(to.checkIn).getTime();
    t < toStayDate(to.checkOut).getTime();
    t += 86_400_000
  ) {
    if (!held.has(t)) added.push(new Date(t));
  }
  return added;
}
