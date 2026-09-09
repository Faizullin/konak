import "server-only";
import { TRPCError } from "@trpc/server";
import { fieldError } from "@/server/errors";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { requirePropertyMember } from "@/features/properties/server";
import { nightsOf, toStayDate } from "@/features/reservations";
import {
  quoteInputSchema,
  rateCalendarInputSchema,
  setRatesSchema,
  setRestrictionsSchema,
} from "../model";
import { quoteStay, refusalMessage } from "./service";

/**
 * Rates — what a stay costs, and the calendar behind it.
 *
 * Editing is by date range because that is how a rate is actually set: a price
 * for a season, not a row per day typed by hand.
 *
 * The local guard here was named `requirePropertyManager` but only ever checked
 * membership; it is now the shared `requirePropertyMember`, which is what it
 * did. Whether setting a season's prices should require a manager is a decision
 * about roles, not a rename.
 */

export const rateRouter = createTRPCRouter({
  /** A price and a verdict. `refusal` is why it may not be sold, if it may not. */
  quote: protectedProcedure.input(quoteInputSchema).query(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);
    return quoteStay(input);
  }),

  calendar: protectedProcedure.input(rateCalendarInputSchema).query(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    const [prices, restrictions] = await Promise.all([
      ctx.db.rateCalendar.findMany({
        where: {
          ratePlanId: input.ratePlanId,
          roomTypeId: input.roomTypeId,
          date: { gte: toStayDate(input.from), lt: toStayDate(input.to) },
        },
        orderBy: { date: "asc" },
      }),
      ctx.db.rateRestriction.findMany({
        where: {
          ratePlanId: input.ratePlanId,
          roomTypeId: input.roomTypeId,
          date: { gte: toStayDate(input.from), lt: toStayDate(input.to) },
        },
        orderBy: { date: "asc" },
      }),
    ]);

    return { prices, restrictions };
  }),

  setRates: protectedProcedure.input(setRatesSchema).mutation(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    const days = nightsOf({ checkIn: toStayDate(input.from), checkOut: toStayDate(input.to) });
    if (days.length === 0) {
      throw fieldError("to", "The range must cover at least one day", "BAD_REQUEST");
    }

    const plan = await ctx.db.ratePlan.findFirst({
      where: { id: input.ratePlanId, propertyId: input.propertyId },
      select: { id: true },
    });
    if (!plan) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Rate plan not found" });
    }

    // Replace the range rather than upserting a row at a time: a season is
    // ninety days, and ninety round trips is the difference between a save that
    // feels instant and one that does not. Deleting exactly the range written
    // makes this identical in effect to the upserts it replaces.
    await ctx.db.$transaction(async (tx) => {
      await tx.rateCalendar.deleteMany({
        where: {
          ratePlanId: input.ratePlanId,
          roomTypeId: input.roomTypeId,
          date: { in: days },
        },
      });
      await tx.rateCalendar.createMany({
        data: days.map((date) => ({
          ratePlanId: input.ratePlanId,
          roomTypeId: input.roomTypeId,
          date,
          priceMinor: input.priceMinor,
        })),
      });
    });

    return { days: days.length };
  }),

  setRestrictions: protectedProcedure
    .input(setRestrictionsSchema)
    .mutation(async ({ ctx, input }) => {
      await requirePropertyMember(ctx, input.propertyId);

      const days = nightsOf({ checkIn: toStayDate(input.from), checkOut: toStayDate(input.to) });
      if (days.length === 0) {
        throw fieldError("to", "The range must cover at least one day", "BAD_REQUEST");
      }

      const values = {
        minLengthOfStay: input.minLengthOfStay ?? null,
        maxLengthOfStay: input.maxLengthOfStay ?? null,
        closed: input.closed ?? false,
        closedToArrival: input.closedToArrival ?? false,
        closedToDeparture: input.closedToDeparture ?? false,
      };

      await ctx.db.$transaction(async (tx) => {
        await tx.rateRestriction.deleteMany({
          where: {
            ratePlanId: input.ratePlanId,
            roomTypeId: input.roomTypeId,
            date: { in: days },
          },
        });
        await tx.rateRestriction.createMany({
          data: days.map((date) => ({
            ratePlanId: input.ratePlanId,
            roomTypeId: input.roomTypeId,
            date,
            ...values,
          })),
        });
      });

      return { days: days.length };
    }),
});

export { refusalMessage };
