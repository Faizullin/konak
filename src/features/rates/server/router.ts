import "server-only";
import { TRPCError } from "@trpc/server";
import { requireOrgMember } from "@/server/auth";
import { fieldError } from "@/server/errors";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import prisma from "@/server/db";
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
 */

async function requirePropertyManager(
  ctx: { db: typeof prisma; session: Parameters<typeof requireOrgMember>[0]["session"] },
  propertyId: number
) {
  const property = await ctx.db.property.findUnique({
    where: { id: propertyId },
    select: { id: true, organizationId: true },
  });
  if (!property) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Property not found" });
  }
  return requireOrgMember(ctx, property.organizationId);
}

export const rateRouter = createTRPCRouter({
  /** A price and a verdict. `refusal` is why it may not be sold, if it may not. */
  quote: protectedProcedure.input(quoteInputSchema).query(async ({ ctx, input }) => {
    await requirePropertyManager(ctx, input.propertyId);
    return quoteStay(input);
  }),

  calendar: protectedProcedure.input(rateCalendarInputSchema).query(async ({ ctx, input }) => {
    await requirePropertyManager(ctx, input.propertyId);

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
    await requirePropertyManager(ctx, input.propertyId);

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

    await ctx.db.$transaction(
      days.map((date) =>
        ctx.db.rateCalendar.upsert({
          where: {
            ratePlanId_roomTypeId_date: {
              ratePlanId: input.ratePlanId,
              roomTypeId: input.roomTypeId,
              date,
            },
          },
          update: { priceMinor: input.priceMinor },
          create: {
            ratePlanId: input.ratePlanId,
            roomTypeId: input.roomTypeId,
            date,
            priceMinor: input.priceMinor,
          },
        })
      )
    );

    return { days: days.length };
  }),

  setRestrictions: protectedProcedure
    .input(setRestrictionsSchema)
    .mutation(async ({ ctx, input }) => {
      await requirePropertyManager(ctx, input.propertyId);

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

      await ctx.db.$transaction(
        days.map((date) =>
          ctx.db.rateRestriction.upsert({
            where: {
              ratePlanId_roomTypeId_date: {
                ratePlanId: input.ratePlanId,
                roomTypeId: input.roomTypeId,
                date,
              },
            },
            update: values,
            create: {
              ratePlanId: input.ratePlanId,
              roomTypeId: input.roomTypeId,
              date,
              ...values,
            },
          })
        )
      );

      return { days: days.length };
    }),
});

export { refusalMessage };
