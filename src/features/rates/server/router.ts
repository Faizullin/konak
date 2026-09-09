import "server-only";
import prisma from "@/server/db";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "@/server/errors";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { requirePropertyMember } from "@/features/properties/server";
import { nightsOf, toStayDate } from "@/features/reservations";
import {
  archiveRatePlanSchema,
  RateError,
  canArchiveRatePlans,
  canManageRatePlans,
  canSetRates,
  createRatePlanSchema,
  listRatePlansSchema,
  quoteInputSchema,
  rateCalendarInputSchema,
  refuseCancellationTerms,
  setRatesSchema,
  setRestrictionsSchema,
  updateRatePlanSchema,
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
 * did. Whether setting a season's prices should require a manager was left open
 * at that rename and is now decided: it does. `canSetRates` grants OWNER and
 * ADMIN and withholds MEMBER, because a wrong nightly rate is money and it
 * reaches every channel the moment it is written.
 */

type Db = typeof prisma;

async function assertPlanOwned(db: Db, id: number, propertyId: number) {
  const found = await db.ratePlan.count({ where: { id, propertyId } });
  if (found === 0) {
    throw new NotFoundError(RateError.PLAN_NOT_FOUND, "Rate plan not found");
  }
}

/** `@@unique([propertyId, code])`, refused as a sentence rather than a 500. */
async function assertPlanCodeFree(db: Db, propertyId: number, code: string, exceptId?: number) {
  const clash = await db.ratePlan.findFirst({
    where: { propertyId, code, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError(
      RateError.PLAN_CODE_TAKEN,
      "That code is already used in this property",
      "code"
    );
  }
}

/**
 * The two things a plan's own fields cannot check: that its terms agree with
 * each other, and that a plan scoped to a room type is scoped to one of *this*
 * property's.
 */
async function assertPlanShape(
  db: Db,
  plan: {
    propertyId: number;
    roomTypeId: number | null;
    isRefundable: boolean;
    cancellationCutoffHours: number | null;
  }
) {
  const refusal = refuseCancellationTerms(plan);
  if (refusal) {
    throw new InvalidError(RateError.PLAN_TERMS_INVALID, refusal, "cancellationCutoffHours");
  }

  if (plan.roomTypeId !== null) {
    const found = await db.roomType.count({
      where: { id: plan.roomTypeId, propertyId: plan.propertyId },
    });
    if (found === 0) {
      throw new NotFoundError(
        RateError.PLAN_ROOM_TYPE_MISMATCH,
        "That room type is not in this property"
      );
    }
  }
}

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
    const { role } = await requirePropertyMember(ctx, input.propertyId);
    if (!canSetRates(role)) {
      throw new ForbiddenError(RateError.PRICES_FORBIDDEN, "You cannot change prices");
    }

    const days = nightsOf({ checkIn: toStayDate(input.from), checkOut: toStayDate(input.to) });
    if (days.length === 0) {
      throw new InvalidError(
        RateError.RANGE_INVALID,
        "The range must cover at least one day",
        "to"
      );
    }

    const plan = await ctx.db.ratePlan.findFirst({
      where: { id: input.ratePlanId, propertyId: input.propertyId },
      select: { id: true },
    });
    if (!plan) {
      throw new NotFoundError(RateError.PLAN_NOT_FOUND, "Rate plan not found");
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
      const { role } = await requirePropertyMember(ctx, input.propertyId);
      if (!canSetRates(role)) {
        throw new ForbiddenError(
          RateError.RESTRICTIONS_FORBIDDEN,
          "You cannot change restrictions"
        );
      }

      const days = nightsOf({ checkIn: toStayDate(input.from), checkOut: toStayDate(input.to) });
      if (days.length === 0) {
        throw new InvalidError(
          RateError.RANGE_INVALID,
          "The range must cover at least one day",
          "to"
        );
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

  /** The plans a stay can be quoted on. The axis every rate screen is drawn against. */
  listPlans: protectedProcedure.input(listRatePlansSchema).query(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    return ctx.db.ratePlan.findMany({
      where: {
        propertyId: input.propertyId,
        ...(input.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        roomTypeId: true,
        name: true,
        code: true,
        currencyCode: true,
        mealPlan: true,
        isRefundable: true,
        cancellationCutoffHours: true,
        cancellationPolicy: true,
        extraAdultMinor: true,
        extraChildMinor: true,
        defaultMinLengthOfStay: true,
        archivedAt: true,
      },
    });
  }),

  createPlan: protectedProcedure.input(createRatePlanSchema).mutation(async ({ ctx, input }) => {
    const { user, role } = await requirePropertyMember(ctx, input.propertyId);
    if (!canManageRatePlans(role)) {
      throw new ForbiddenError(RateError.PLAN_CREATE_FORBIDDEN, "You cannot add rate plans");
    }
    await assertPlanShape(ctx.db, input);
    await assertPlanCodeFree(ctx.db, input.propertyId, input.code);

    return ctx.db.ratePlan.create({
      data: { ...input, createdById: user.id, updatedById: user.id },
    });
  }),

  updatePlan: protectedProcedure.input(updateRatePlanSchema).mutation(async ({ ctx, input }) => {
    const { user, role } = await requirePropertyMember(ctx, input.propertyId);
    if (!canManageRatePlans(role)) {
      throw new ForbiddenError(RateError.PLAN_UPDATE_FORBIDDEN, "You cannot edit rate plans");
    }

    const { id, propertyId, ...data } = input;
    await assertPlanOwned(ctx.db, id, propertyId);
    await assertPlanShape(ctx.db, { propertyId, ...data });
    await assertPlanCodeFree(ctx.db, propertyId, data.code, id);

    return ctx.db.ratePlan.update({ where: { id }, data: { ...data, updatedById: user.id } });
  }),

  /**
   * Archiving withdraws a plan from sale and keeps it: the stays sold on it
   * still quote from its terms, and a folio that lost its plan cannot explain
   * its own total.
   */
  archivePlan: protectedProcedure.input(archiveRatePlanSchema).mutation(async ({ ctx, input }) => {
    const { user, role } = await requirePropertyMember(ctx, input.propertyId);
    if (!canArchiveRatePlans(role)) {
      throw new ForbiddenError(RateError.PLAN_ARCHIVE_FORBIDDEN, "You cannot archive rate plans");
    }
    await assertPlanOwned(ctx.db, input.id, input.propertyId);

    return ctx.db.ratePlan.update({
      where: { id: input.id },
      data: { archivedAt: input.archived ? new Date() : null, updatedById: user.id },
    });
  }),
});

export { refusalMessage };
