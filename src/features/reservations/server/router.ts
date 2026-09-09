import "server-only";
import { z } from "zod";
import { ConflictError, InvalidError, NotFoundError } from "@/server/errors";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { ReservationError } from "../model";
import { createGuestPerson } from "@/features/directory/server";
import { isRoomSellable, ROOM_STATUS_LABELS, type RoomStatus } from "@/features/properties";
import { requirePropertyMember } from "@/features/properties/server";
import {
  assignRoomSchema,
  availabilityInputSchema,
  holdInputSchema,
  releaseHoldSchema,
  addedNights,
  createReservationSchema,
  frontDeskDaySchema,
  gridWindowSchema,
  isValidStayRange,
  moveStaySchema,
  nightsOf,
  refuseStatusChange,
  refuseStayMove,
  ReservationStatus,
  setReservationStatusSchema,
  todayAt,
  toStayDate,
  walkInSchema,
} from "../model";
import { quoteStay, refusalMessage } from "@/features/rates/server";
import { availability, frontDeskDay, frontDeskGrid, nextSeriesNumber } from "./service";

/**
 * Reservations — availability, and the four things a desk does to a booking.
 *
 * Every procedure resolves the property to its organization first, then checks
 * membership — `requirePropertyMember`, which the properties feature owns and
 * which decides the two refusals: an unknown id is NOT_FOUND, another tenant's
 * is FORBIDDEN.
 */

export const reservationRouter = createTRPCRouter({
  /** Free rooms per type per night. Derived, never read from a flag. */
  availability: protectedProcedure.input(availabilityInputSchema).query(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);
    return availability(input);
  }),

  /**
   * The front desk grid for one window: rooms, the stays that touch it, what is
   * still unassigned, and availability per type per night — one call rather
   * than one per room, which is the contract `roadmap.md` Phase 4 asks for.
   */
  grid: protectedProcedure.input(gridWindowSchema).query(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);
    return frontDeskGrid(input);
  }),

  /**
   * Arrivals, departures and who is in house, for one day. The grid draws the
   * month; this is the list a receptionist actually works down.
   */
  day: protectedProcedure.input(frontDeskDaySchema).query(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);
    return frontDeskDay(input);
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
      throw new InvalidError(
        ReservationError.STAY_TOO_SHORT,
        "A stay is at least one night",
        "checkOut"
      );
    }

    const roomType = await ctx.db.roomType.findFirst({
      where: { id: input.roomTypeId, propertyId: input.propertyId },
      select: { id: true, maxOccupancy: true },
    });
    if (!roomType) {
      throw new NotFoundError(ReservationError.ROOM_TYPE_NOT_FOUND, "Room type not found");
    }
    if (input.adults + input.children > roomType.maxOccupancy) {
      throw new InvalidError(
        ReservationError.STAY_OVER_OCCUPANCY,
        "That is more people than the room type sleeps",
        "adults"
      );
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
      throw new ConflictError(
        ReservationError.STAY_SOLD_OUT,
        `No rooms of that type free on ${soldOut.date.toISOString().slice(0, 10)}`,
        "checkIn"
      ).with({ date: soldOut.date.toISOString().slice(0, 10) });
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
        throw new ConflictError(
          ReservationError.STAY_NO_PRICE,
          refusalMessage(quote.refusal ?? "NO_PRICE"),
          "ratePlanId"
        );
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
      throw new InvalidError(
        ReservationError.STAY_TOO_SHORT,
        "A stay is at least one night",
        "checkOut"
      );
    }

    const roomType = await ctx.db.roomType.findFirst({
      where: { id: input.roomTypeId, propertyId: input.propertyId },
      select: { id: true },
    });
    if (!roomType) {
      throw new NotFoundError(ReservationError.ROOM_TYPE_NOT_FOUND, "Room type not found");
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
        throw new ConflictError(
          ReservationError.HOLD_SHORT,
          `Only ${short.available} free on ${short.date.toISOString().slice(0, 10)}`,
          "checkIn"
        ).with({ available: short.available, date: short.date.toISOString().slice(0, 10) });
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
        select: {
          id: true,
          status: true,
          property: { select: { timezone: true } },
          // Check-in reads the rooms and the dates, so the rule sees the whole
          // booking rather than the column alone.
          stays: { select: { roomId: true, checkIn: true, checkOut: true } },
        },
      });
      if (!reservation) {
        throw new NotFoundError(ReservationError.NOT_FOUND, "Reservation not found");
      }

      // The rule is a pure function in `model/`; this is the two writes it
      // permits, and the sentence it refuses with is the one the screen shows.
      const refusal = refuseStatusChange({
        from: reservation.status,
        to: input.status,
        stays: reservation.stays,
        today: todayAt(reservation.property.timezone),
      });
      if (refusal) {
        throw new InvalidError(ReservationError.STATUS_REFUSED, refusal);
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
      throw new NotFoundError(ReservationError.STAY_NOT_FOUND, "Stay not found");
    }

    if (input.roomId !== null) {
      const room = await ctx.db.room.findFirst({
        where: { id: input.roomId, propertyId: input.propertyId },
        select: { id: true, roomTypeId: true },
      });
      if (!room) {
        throw new NotFoundError(ReservationError.ROOM_NOT_FOUND, "Room not found");
      }
      if (room.roomTypeId !== stay.roomTypeId) {
        throw new InvalidError(
          ReservationError.ROOM_WRONG_TYPE,
          "That room is a different type",
          "roomId"
        );
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
        throw new ConflictError(
          ReservationError.ROOM_TAKEN,
          "That room is taken for part of this stay",
          "roomId"
        );
      }
      throw error;
    }
  }),

  /**
   * A guest at the desk: booked, given a room and checked in, in one action.
   *
   * Not `create` then `assignRoom` then `setStatus` — that is three round trips
   * where the second can fail after the first succeeded, leaving a booking
   * nobody decided to make. One transaction, or none of it.
   *
   * The status rules are satisfied by construction rather than re-checked: the
   * schema requires a room, and the arrival is the property's own today, which
   * is exactly what `refuseStatusChange` asks of a check-in.
   */
  walkIn: protectedProcedure.input(walkInSchema).mutation(async ({ ctx, input }) => {
    const { property: scope, user } = await requirePropertyMember(ctx, input.propertyId);

    const property = await ctx.db.property.findUniqueOrThrow({
      where: { id: input.propertyId },
      select: { currencyCode: true, timezone: true },
    });

    // The hotel's day, not the browser's: a walk-in at 01:00 is still tonight.
    const checkIn = todayAt(property.timezone);
    const checkOut = toStayDate(new Date(checkIn.getTime() + input.nights * 86_400_000));

    const room = await ctx.db.room.findFirst({
      where: { id: input.roomId, propertyId: input.propertyId, archivedAt: null },
      select: {
        id: true,
        roomTypeId: true,
        status: true,
        roomType: { select: { maxOccupancy: true } },
      },
    });
    if (!room) {
      throw new NotFoundError(ReservationError.ROOM_NOT_FOUND, "Room not found");
    }
    if (room.roomTypeId !== input.roomTypeId) {
      throw new InvalidError(
        ReservationError.ROOM_WRONG_TYPE,
        "That room is a different type",
        "roomId"
      );
    }
    if (!isRoomSellable(room.status)) {
      const label = ROOM_STATUS_LABELS[room.status as RoomStatus] ?? room.status;
      throw new ConflictError(
        ReservationError.ROOM_NOT_SELLABLE,
        `That room is ${label.toLowerCase()} and cannot be sold`,
        "roomId"
      ).with({ status: label.toLowerCase() });
    }
    if (input.adults + input.children > room.roomType.maxOccupancy) {
      throw new InvalidError(
        ReservationError.STAY_OVER_OCCUPANCY,
        "That is more people than the room type sleeps",
        "adults"
      );
    }

    const nights = await availability({
      propertyId: input.propertyId,
      roomTypeId: input.roomTypeId,
      from: checkIn,
      to: checkOut,
    });
    const soldOut = nights.find((night) => night.available < 1);
    if (soldOut) {
      throw new ConflictError(
        ReservationError.STAY_SOLD_OUT,
        `No rooms of that type free on ${soldOut.date.toISOString().slice(0, 10)}`,
        "nights"
      ).with({ date: soldOut.date.toISOString().slice(0, 10) });
    }

    let currencyCode = property.currencyCode;
    let totalMinor = 0;
    if (input.ratePlanId) {
      const quote = await quoteStay({
        propertyId: input.propertyId,
        roomTypeId: input.roomTypeId,
        ratePlanId: input.ratePlanId,
        checkIn,
        checkOut,
        adults: input.adults,
        children: input.children,
      });
      if (quote.refusal || quote.totalMinor === null) {
        throw new ConflictError(
          ReservationError.STAY_NO_PRICE,
          refusalMessage(quote.refusal ?? "NO_PRICE"),
          "ratePlanId"
        );
      }
      currencyCode = quote.currencyCode;
      totalMinor = quote.totalMinor;
    }

    try {
      return await ctx.db.$transaction(async (tx) => {
        const reference = await nextSeriesNumber(tx, {
          organizationId: scope.organizationId,
          propertyId: scope.id,
          kind: "RESERVATION",
        });

        // The guest is part of the booking, so it is written with it — the
        // directory feature owns the write, this owns the transaction.
        const booker = await createGuestPerson(
          tx,
          {
            organizationId: scope.organizationId,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            phone: input.phone,
          },
          user.id
        );

        return tx.reservation.create({
          data: {
            propertyId: input.propertyId,
            reference,
            status: ReservationStatus.CHECKED_IN,
            source: "WALK_IN",
            bookerPersonId: booker.id,
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
                  status: ReservationStatus.CHECKED_IN,
                  checkIn,
                  checkOut,
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
    } catch (error) {
      // Someone else took the room between the availability read and the write.
      if (String(error).includes("room_stays_no_overlap")) {
        throw new ConflictError(
          ReservationError.ROOM_TAKEN,
          "That room is taken for part of this stay",
          "roomId"
        );
      }
      throw error;
    }
  }),

  /**
   * Move a stay's nights, and its room in the same drag.
   *
   * `assignRoom` answers "which room" and this answers "which nights" — one
   * procedure for both because a grid drag changes both at once, and two calls
   * would let the room land while the dates were refused.
   *
   * The rule is `refuseStayMove` in `model/`; the overlap is the exclusion
   * constraint, which is the only answer that stays true under two clerks.
   */
  moveStay: protectedProcedure.input(moveStaySchema).mutation(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    const stay = await ctx.db.roomStay.findFirst({
      where: { id: input.stayId, reservation: { propertyId: input.propertyId } },
      select: {
        id: true,
        status: true,
        roomId: true,
        roomTypeId: true,
        ratePlanId: true,
        checkIn: true,
        checkOut: true,
        adults: true,
        children: true,
        currencyCode: true,
        reservationId: true,
        reservation: { select: { property: { select: { timezone: true } } } },
      },
    });
    if (!stay) {
      throw new NotFoundError(ReservationError.STAY_NOT_FOUND, "Stay not found");
    }

    const to = { checkIn: toStayDate(input.checkIn), checkOut: toStayDate(input.checkOut) };
    const from = { checkIn: stay.checkIn, checkOut: stay.checkOut };

    const refusal = refuseStayMove({
      status: stay.status,
      from,
      to,
      today: todayAt(stay.reservation.property.timezone),
    });
    if (refusal) {
      throw new InvalidError(ReservationError.STAY_MOVE_REFUSED, refusal, "checkOut");
    }

    // `undefined` leaves the room alone; `null` puts the stay back on its type.
    const roomId = input.roomId === undefined ? stay.roomId : input.roomId;
    if (roomId !== null && roomId !== stay.roomId) {
      const room = await ctx.db.room.findFirst({
        where: { id: roomId, propertyId: input.propertyId },
        select: { id: true, roomTypeId: true },
      });
      if (!room) {
        throw new NotFoundError(ReservationError.ROOM_NOT_FOUND, "Room not found");
      }
      if (room.roomTypeId !== stay.roomTypeId) {
        throw new InvalidError(
          ReservationError.ROOM_WRONG_TYPE,
          "That room is a different type",
          "roomId"
        );
      }
    }

    // Only the nights the move adds are asked about. Over the whole new range
    // the stay would find itself already there and refuse its own move.
    const added = addedNights(from, to);
    if (added.length > 0) {
      const nights = await availability({
        propertyId: input.propertyId,
        roomTypeId: stay.roomTypeId,
        from: to.checkIn,
        to: to.checkOut,
      });
      const wanted = new Set(added.map((night) => night.getTime()));
      const soldOut = nights.find(
        (night) => wanted.has(night.date.getTime()) && night.available < 1
      );
      if (soldOut) {
        throw new ConflictError(
          ReservationError.STAY_SOLD_OUT,
          `No rooms of that type free on ${soldOut.date.toISOString().slice(0, 10)}`,
          "checkIn"
        ).with({ date: soldOut.date.toISOString().slice(0, 10) });
      }
    }

    // The nights changed, so the price did. A priced stay is re-quoted rather
    // than carried across, which is what makes a move a decision.
    let currencyCode = stay.currencyCode;
    let totalMinor: number | undefined;
    if (stay.ratePlanId) {
      const quote = await quoteStay({
        propertyId: input.propertyId,
        roomTypeId: stay.roomTypeId,
        ratePlanId: stay.ratePlanId,
        checkIn: to.checkIn,
        checkOut: to.checkOut,
        adults: stay.adults,
        children: stay.children,
      });
      if (quote.refusal || quote.totalMinor === null) {
        throw new ConflictError(
          ReservationError.STAY_NO_PRICE,
          refusalMessage(quote.refusal ?? "NO_PRICE"),
          "checkIn"
        );
      }
      currencyCode = quote.currencyCode;
      totalMinor = quote.totalMinor;
    }

    try {
      return await ctx.db.$transaction(async (tx) => {
        const moved = await tx.roomStay.update({
          where: { id: stay.id },
          data: {
            checkIn: to.checkIn,
            checkOut: to.checkOut,
            roomId,
            ...(totalMinor === undefined ? {} : { currencyCode, totalMinor }),
          },
        });

        // The reservation's total is the sum of its stays, so a re-quoted stay
        // that left the header behind would make the folio disagree with itself.
        if (totalMinor !== undefined) {
          const stays = await tx.roomStay.findMany({
            where: { reservationId: stay.reservationId },
            select: { totalMinor: true },
          });
          await tx.reservation.update({
            where: { id: stay.reservationId },
            data: { totalMinor: stays.reduce((sum, row) => sum + row.totalMinor, 0) },
          });
        }

        return moved;
      });
    } catch (error) {
      // The exclusion constraint, surfacing as a sentence rather than a 500.
      if (String(error).includes("room_stays_no_overlap")) {
        throw new ConflictError(
          ReservationError.ROOM_TAKEN,
          "That room is taken for part of those nights",
          "roomId"
        );
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
        throw new NotFoundError(ReservationError.STAY_NOT_FOUND, "Stay not found");
      }
      return nightsOf(stay);
    }),
});
