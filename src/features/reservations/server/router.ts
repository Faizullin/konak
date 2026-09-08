import "server-only";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { requireOrgMember } from "@/server/auth";
import { fieldError } from "@/server/errors";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import prisma from "@/server/db";
import {
  assignRoomSchema,
  availabilityInputSchema,
  holdInputSchema,
  releaseHoldSchema,
  canTransition,
  createReservationSchema,
  isValidStayRange,
  nightsOf,
  ReservationStatus,
  setReservationStatusSchema,
  toStayDate,
} from "../model";
import { quoteStay, refusalMessage } from "@/features/rates/server";
import { availability, nextSeriesNumber } from "./service";

/**
 * Reservations — availability, and the four things a desk does to a booking.
 *
 * Every procedure resolves the property to its organization first, then checks
 * membership. A property id that belongs to another tenant is indistinguishable
 * from one that does not exist.
 */

async function requirePropertyMember(
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
  const member = await requireOrgMember(ctx, property.organizationId);
  return { property, ...member };
}

export const reservationRouter = createTRPCRouter({
  /** Free rooms per type per night. Derived, never read from a flag. */
  availability: protectedProcedure.input(availabilityInputSchema).query(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);
    return availability(input);
  }),

  list: protectedProcedure
    .input(
      z.object({
        propertyId: z.number(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        status: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requirePropertyMember(ctx, input.propertyId);

      return ctx.db.reservation.findMany({
        where: {
          propertyId: input.propertyId,
          ...(input.status ? { status: input.status } : {}),
          ...(input.from && input.to
            ? { stays: { some: { checkIn: { lt: input.to }, checkOut: { gt: input.from } } } }
            : {}),
        },
        include: { stays: true, booker: true },
        orderBy: { bookedAt: "desc" },
        take: 200,
      });
    }),

  create: protectedProcedure.input(createReservationSchema).mutation(async ({ ctx, input }) => {
    const { property: scope, user } = await requirePropertyMember(ctx, input.propertyId);

    const range = { checkIn: toStayDate(input.checkIn), checkOut: toStayDate(input.checkOut) };
    if (!isValidStayRange(range)) {
      throw fieldError("checkOut", "A stay is at least one night", "BAD_REQUEST");
    }

    const roomType = await ctx.db.roomType.findFirst({
      where: { id: input.roomTypeId, propertyId: input.propertyId },
      select: { id: true, maxOccupancy: true },
    });
    if (!roomType) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Room type not found" });
    }
    if (input.adults + input.children > roomType.maxOccupancy) {
      throw fieldError("adults", "That is more people than the room type sleeps", "BAD_REQUEST");
    }

    // Availability is checked here and the database refuses an overlapping
    // *room*. Between the two, the check is what gives a usable message and the
    // constraint is what is actually true.
    const nights = await availability({
      propertyId: input.propertyId,
      roomTypeId: input.roomTypeId,
      from: range.checkIn,
      to: range.checkOut,
    });
    const soldOut = nights.find((night) => night.available < 1);
    if (soldOut) {
      throw fieldError(
        "checkIn",
        `No rooms of that type free on ${soldOut.date.toISOString().slice(0, 10)}`,
        "CONFLICT"
      );
    }

    // A rate plan makes the booking priced; without one it is a held room with
    // no money attached, which is a real case at a front desk.
    const property = await ctx.db.property.findUniqueOrThrow({
      where: { id: input.propertyId },
      select: { currencyCode: true },
    });
    let currencyCode = property.currencyCode;
    let totalMinor = 0;

    if (input.ratePlanId) {
      const quote = await quoteStay({
        propertyId: input.propertyId,
        roomTypeId: input.roomTypeId,
        ratePlanId: input.ratePlanId,
        checkIn: range.checkIn,
        checkOut: range.checkOut,
        adults: input.adults,
        children: input.children,
      });
      if (quote.refusal || quote.totalMinor === null) {
        throw fieldError("ratePlanId", refusalMessage(quote.refusal ?? "NO_PRICE"), "CONFLICT");
      }
      currencyCode = quote.currencyCode;
      totalMinor = quote.totalMinor;
    }

    return ctx.db.$transaction(async (tx) => {
      const reference = await nextSeriesNumber(tx, {
        organizationId: scope.organizationId,
        propertyId: scope.id,
        kind: "RESERVATION",
      });

      return tx.reservation.create({
        data: {
          propertyId: input.propertyId,
          reference,
          status: ReservationStatus.CONFIRMED,
          source: input.source,
          bookerPersonId: input.bookerPersonId,
          companyId: input.companyId,
          currencyCode,
          totalMinor,
          notes: input.notes,
          createdById: user.id,
          updatedById: user.id,
          stays: {
            create: [
              {
                roomTypeId: input.roomTypeId,
                ratePlanId: input.ratePlanId,
                roomId: input.roomId,
                status: ReservationStatus.CONFIRMED,
                checkIn: range.checkIn,
                checkOut: range.checkOut,
                adults: input.adults,
                children: input.children,
                currencyCode,
                totalMinor,
              },
            ],
          },
        },
        include: { stays: true },
      });
    });
  }),

  /**
   * Hold rooms while a booking is being made.
   *
   * A database constraint refuses the *second writer*; a hold stops the second
   * guest ever reaching payment. `releaseAt` is what gives the rooms back when
   * a checkout is abandoned, with no job to run.
   */
  hold: protectedProcedure.input(holdInputSchema).mutation(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    const range = { checkIn: toStayDate(input.checkIn), checkOut: toStayDate(input.checkOut) };
    if (!isValidStayRange(range)) {
      throw fieldError("checkOut", "A stay is at least one night", "BAD_REQUEST");
    }

    const roomType = await ctx.db.roomType.findFirst({
      where: { id: input.roomTypeId, propertyId: input.propertyId },
      select: { id: true },
    });
    if (!roomType) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Room type not found" });
    }

    // Availability already discounts live holds, so re-using a key extends the
    // existing hold instead of competing with it.
    const existing = await ctx.db.inventoryHold.findUnique({
      where: { holdKey: input.holdKey },
      select: { id: true },
    });
    if (!existing) {
      const nights = await availability({
        propertyId: input.propertyId,
        roomTypeId: input.roomTypeId,
        from: range.checkIn,
        to: range.checkOut,
      });
      const short = nights.find((night) => night.available < input.quantity);
      if (short) {
        throw fieldError(
          "checkIn",
          `Only ${short.available} free on ${short.date.toISOString().slice(0, 10)}`,
          "CONFLICT"
        );
      }
    }

    const releaseAt = new Date(Date.now() + input.minutes * 60_000);

    return ctx.db.inventoryHold.upsert({
      where: { holdKey: input.holdKey },
      update: { releaseAt, quantity: input.quantity },
      create: {
        roomTypeId: input.roomTypeId,
        checkIn: range.checkIn,
        checkOut: range.checkOut,
        quantity: input.quantity,
        holdKey: input.holdKey,
        releaseAt,
      },
    });
  }),

  releaseHold: protectedProcedure.input(releaseHoldSchema).mutation(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);
    // Idempotent: an abandoned checkout may release twice, or never.
    await ctx.db.inventoryHold.deleteMany({ where: { holdKey: input.holdKey } });
    return { released: true };
  }),

  setStatus: protectedProcedure
    .input(setReservationStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const { user } = await requirePropertyMember(ctx, input.propertyId);

      const reservation = await ctx.db.reservation.findFirst({
        where: { id: input.id, propertyId: input.propertyId },
        select: { id: true, status: true },
      });
      if (!reservation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Reservation not found" });
      }

      // The legal transitions are a pure function in `model/`; this is the two
      // writes it permits.
      if (!canTransition(reservation.status, input.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A ${reservation.status.toLowerCase()} reservation cannot become ${input.status.toLowerCase()}`,
        });
      }

      return ctx.db.$transaction(async (tx) => {
        // The stay carries its own status because the overlap constraint reads
        // it; the two must move together.
        await tx.roomStay.updateMany({
          where: { reservationId: input.id },
          data: { status: input.status },
        });

        return tx.reservation.update({
          where: { id: input.id },
          data: {
            status: input.status,
            updatedById: user.id,
            ...(input.status === ReservationStatus.CANCELLED
              ? { cancelledAt: new Date(), cancellationReason: input.reason }
              : {}),
          },
        });
      });
    }),

  assignRoom: protectedProcedure.input(assignRoomSchema).mutation(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    const stay = await ctx.db.roomStay.findFirst({
      where: { id: input.stayId, reservation: { propertyId: input.propertyId } },
      select: { id: true, roomTypeId: true, checkIn: true, checkOut: true },
    });
    if (!stay) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Stay not found" });
    }

    if (input.roomId !== null) {
      const room = await ctx.db.room.findFirst({
        where: { id: input.roomId, propertyId: input.propertyId },
        select: { id: true, roomTypeId: true },
      });
      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }
      if (room.roomTypeId !== stay.roomTypeId) {
        throw fieldError("roomId", "That room is a different type", "BAD_REQUEST");
      }
    }

    try {
      return await ctx.db.roomStay.update({
        where: { id: input.stayId },
        data: { roomId: input.roomId },
      });
    } catch (error) {
      // The exclusion constraint, surfacing as a message rather than a 500.
      // Nothing else can raise it on this update.
      if (String(error).includes("room_stays_no_overlap")) {
        throw fieldError("roomId", "That room is taken for part of this stay", "CONFLICT");
      }
      throw error;
    }
  }),

  nightsFor: protectedProcedure
    .input(z.object({ propertyId: z.number(), stayId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requirePropertyMember(ctx, input.propertyId);
      const stay = await ctx.db.roomStay.findFirst({
        where: { id: input.stayId, reservation: { propertyId: input.propertyId } },
        select: { checkIn: true, checkOut: true },
      });
      if (!stay) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stay not found" });
      }
      return nightsOf(stay);
    }),
});
