/**
 * What a stay costs, and whether it may be sold at all.
 *
 * Prices are integer minor units throughout. The nightly price is quoted for
 * the room type's `baseOccupancy`; anyone beyond it is priced per person per
 * night, which is why occupancy belongs to the stay and not to the price.
 */

export type NightlyPrice = { date: Date; priceMinor: number };

export type OccupancyPricing = {
  baseOccupancy: number;
  extraAdultMinor: number;
  extraChildMinor: number;
};

export type StayOccupancy = { adults: number; children: number };

/**
 * Extra people beyond `baseOccupancy`, adults charged before children.
 *
 * A room quoted for two, taken by two adults and a child, is one extra — the
 * child. Taken by three adults it is one extra adult. Counting children first
 * would undercharge every family.
 */
export function extraPersonMinor(occupancy: StayOccupancy, pricing: OccupancyPricing): number {
  const total = occupancy.adults + occupancy.children;
  const extra = Math.max(0, total - pricing.baseOccupancy);
  if (extra === 0) return 0;

  const extraAdults = Math.max(0, Math.min(extra, occupancy.adults - pricing.baseOccupancy));
  const extraChildren = extra - extraAdults;
  return extraAdults * pricing.extraAdultMinor + extraChildren * pricing.extraChildMinor;
}

/**
 * The total for a stay: every night's price plus that night's extra people.
 *
 * Returns `null` when a night has no price. A missing night is not free — it is
 * a room that was never put on sale, and quoting zero for it would sell it.
 */
export function stayTotalMinor(
  nights: NightlyPrice[],
  occupancy: StayOccupancy,
  pricing: OccupancyPricing,
  expectedNights: number
): number | null {
  if (nights.length !== expectedNights || expectedNights < 1) return null;

  const perNightExtra = extraPersonMinor(occupancy, pricing);
  return nights.reduce((total, night) => total + night.priceMinor + perNightExtra, 0);
}

export type Restriction = {
  closed?: boolean;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  minLengthOfStay?: number | null;
  maxLengthOfStay?: number | null;
};

export type SellRefusal =
  "CLOSED" | "CLOSED_TO_ARRIVAL" | "CLOSED_TO_DEPARTURE" | "MIN_STAY" | "MAX_STAY" | "NO_PRICE";

/**
 * Why a stay may not be sold, or `null` if it may.
 *
 * A missing restriction row means unrestricted — an empty calendar sells
 * normally rather than not at all. `closedToDeparture` is checked against the
 * departure day, which is the night *after* the last one occupied.
 */
export function sellRefusal(args: {
  nights: NightlyPrice[];
  expectedNights: number;
  arrivalRestriction?: Restriction | null;
  departureRestriction?: Restriction | null;
  nightRestrictions?: (Restriction | null | undefined)[];
}): SellRefusal | null {
  const { nights, expectedNights, arrivalRestriction, departureRestriction } = args;

  if (nights.length !== expectedNights || expectedNights < 1) return "NO_PRICE";

  for (const restriction of args.nightRestrictions ?? []) {
    if (restriction?.closed) return "CLOSED";
  }
  if (arrivalRestriction?.closedToArrival) return "CLOSED_TO_ARRIVAL";
  if (departureRestriction?.closedToDeparture) return "CLOSED_TO_DEPARTURE";

  const min = arrivalRestriction?.minLengthOfStay;
  if (min != null && expectedNights < min) return "MIN_STAY";

  const max = arrivalRestriction?.maxLengthOfStay;
  if (max != null && expectedNights > max) return "MAX_STAY";

  return null;
}
