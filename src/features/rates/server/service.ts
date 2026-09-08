import "server-only";
import { TRPCError } from "@trpc/server";
import prisma from "@/server/db";
import { nightsBetween, nightsOf, toStayDate } from "@/features/reservations";
import { sellRefusal, stayTotalMinor, type Restriction, type SellRefusal } from "../model";

/**
 * What a stay costs, and whether it may be sold.
 *
 * The arithmetic is `model/pricing.ts` and is tested without a database; what
 * lives here is the reading it needs — the calendar, the restrictions, and the
 * occupancy rules from the room type and the plan.
 */

export type Quote = {
  nights: { date: Date; priceMinor: number }[];
  nightCount: number;
  currencyCode: string;
  totalMinor: number | null;
  refusal: SellRefusal | null;
};

const REFUSAL_MESSAGE: Record<SellRefusal, string> = {
  CLOSED: "That rate is closed on one of those nights",
  CLOSED_TO_ARRIVAL: "That rate cannot start on that date",
  CLOSED_TO_DEPARTURE: "That rate cannot end on that date",
  MIN_STAY: "That rate has a longer minimum stay",
  MAX_STAY: "That rate has a shorter maximum stay",
  NO_PRICE: "That rate has no price for one of those nights",
};

export function refusalMessage(refusal: SellRefusal): string {
  return REFUSAL_MESSAGE[refusal];
}

export async function quoteStay(args: {
  propertyId: number;
  roomTypeId: number;
  ratePlanId: number;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
}): Promise<Quote> {
  const checkIn = toStayDate(args.checkIn);
  const checkOut = toStayDate(args.checkOut);
  const nightCount = nightsBetween(checkIn, checkOut);

  const [roomType, ratePlan] = await Promise.all([
    prisma.roomType.findFirst({
      where: { id: args.roomTypeId, propertyId: args.propertyId },
      select: { baseOccupancy: true },
    }),
    prisma.ratePlan.findFirst({
      where: { id: args.ratePlanId, propertyId: args.propertyId },
      select: { currencyCode: true, extraAdultMinor: true, extraChildMinor: true },
    }),
  ]);
  if (!roomType || !ratePlan) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Room type or rate plan not found" });
  }

  const [calendar, restrictions] = await Promise.all([
    prisma.rateCalendar.findMany({
      where: {
        ratePlanId: args.ratePlanId,
        roomTypeId: args.roomTypeId,
        date: { gte: checkIn, lt: checkOut },
      },
      orderBy: { date: "asc" },
    }),
    // The departure day matters too: `closedToDeparture` is about the day the
    // guest leaves, which is the night after the last one they occupy.
    prisma.rateRestriction.findMany({
      where: {
        ratePlanId: args.ratePlanId,
        roomTypeId: args.roomTypeId,
        date: { gte: checkIn, lte: checkOut },
      },
    }),
  ]);

  const byDate = new Map(restrictions.map((r) => [toStayDate(r.date).getTime(), r as Restriction]));
  const nights = calendar.map((row) => ({
    date: toStayDate(row.date),
    priceMinor: row.priceMinor,
  }));

  const refusal = sellRefusal({
    nights,
    expectedNights: nightCount,
    arrivalRestriction: byDate.get(checkIn.getTime()),
    departureRestriction: byDate.get(checkOut.getTime()),
    nightRestrictions: nightsOf({ checkIn, checkOut }).map((n) => byDate.get(n.getTime())),
  });

  const totalMinor =
    refusal === null
      ? stayTotalMinor(
          nights,
          { adults: args.adults, children: args.children },
          {
            baseOccupancy: roomType.baseOccupancy,
            extraAdultMinor: ratePlan.extraAdultMinor,
            extraChildMinor: ratePlan.extraChildMinor,
          },
          nightCount
        )
      : null;

  return { nights, nightCount, currencyCode: ratePlan.currencyCode, totalMinor, refusal };
}
