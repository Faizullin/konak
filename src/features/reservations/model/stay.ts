/**
 * Stay dates. A stay is the half-open interval `[checkIn, checkOut)` — the
 * departure day is not a night — which is what makes nights a subtraction and
 * back-to-back stays legal in the same room.
 *
 * Dates are date-only: UTC midnight of the property-local day.
 */

const MS_PER_DAY = 86_400_000;

export type StayRange = { checkIn: Date; checkOut: Date };

/** UTC midnight of the day this instant falls in. */
export function toStayDate(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/**
 * The property's own day, as a stay date.
 *
 * A hotel's today ends at its front desk, not at UTC midnight: at 01:00 local
 * an arrival is still yesterday's in Auckland and tomorrow's in Los Angeles,
 * and "has this booking arrived yet" is answered against that day.
 *
 * An unrecognised zone falls back to UTC rather than throwing — a typo in one
 * property's column must not take the front desk down with it.
 */
export function todayAt(timezone: string, now: Date = new Date()): Date {
  const parts = (zone: string) =>
    new Intl.DateTimeFormat("en", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);

  let fields;
  try {
    fields = parts(timezone);
  } catch {
    fields = parts("UTC");
  }

  const part = (type: string) => Number(fields.find((f) => f.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}

export function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.round((toStayDate(checkOut).getTime() - toStayDate(checkIn).getTime()) / MS_PER_DAY);
}

/** A stay is at least one night; a zero-night booking is a mistake, not a day-use rate. */
export function isValidStayRange(range: StayRange): boolean {
  return nightsBetween(range.checkIn, range.checkOut) >= 1;
}

/**
 * **The invariant SQLite cannot hold.** Two stays of the same room may not
 * share a night.
 *
 * Half-open, so a departure on the 4th and an arrival on the 4th do not
 * overlap — that is a same-day turnover, the most ordinary thing a hotel does,
 * and an inclusive comparison would refuse it.
 */
export function staysOverlap(a: StayRange, b: StayRange): boolean {
  return (
    toStayDate(a.checkIn) < toStayDate(b.checkOut) && toStayDate(b.checkIn) < toStayDate(a.checkOut)
  );
}

/** Every night a stay occupies. The departure day is absent by design. */
export function nightsOf(range: StayRange): Date[] {
  const nights: Date[] = [];
  const end = toStayDate(range.checkOut).getTime();
  for (let t = toStayDate(range.checkIn).getTime(); t < end; t += MS_PER_DAY) {
    nights.push(new Date(t));
  }
  return nights;
}

/** How many of `total` remain once holds and occupied rooms are counted. */
export function availableRooms(total: number, blocked: number, occupied: number, held: number) {
  return Math.max(0, total - blocked - occupied - held);
}
