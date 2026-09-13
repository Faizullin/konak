import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/server/db";
import { ConflictError, ForbiddenError, NotFoundError, refused } from "@/server/errors";
import { requireOrgMember } from "@/server/auth";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
// A room cannot be archived out from under a booking, and only reservations
// knows which statuses still hold one. The constants are model-side, so this is
// a read of a shared definition rather than a reach into another feature.
import { GRID_HIDDEN_STATUSES, nightsOf, todayAt } from "@/features/reservations";
// The file, not the barrel. `channels/server`'s barrel re-exports its router,
// which imports *this* feature's `server` barrel for `requirePropertyMember` —
// so going through it is a cycle, and a cycle here is an export that "does not
// exist" at run time. Same reason `channels/server/push.ts` reaches for a
// service module rather than a feature's `server/`.
import { enqueueChannelPush } from "@/features/channels/server/enqueue";
import {
  archiveInventorySchema,
  PropertyError,
  canArchiveRooms,
  canArchiveRoomTypes,
  canManageProperties,
  canManageRooms,
  canManageRoomTypes,
  compareRoomNumbers,
  createPropertySchema,
  createRoomSchema,
  createRoomTypeSchema,
  refuseBlock,
  refuseOccupancy,
  roomSaleState,
  setRoomBlockSchema,
  updateRoomSchema,
  updateRoomTypeSchema,
  listPropertiesSchema,
  listRoomTypesSchema,
  listRoomsSchema,
  PROPERTY_ROUTE_SELECT,
  propertyBySlugSchema,
} from "../model";
import { requirePropertyMember } from "./service";

/**
 * Properties — the hotels an organization runs, and the rooms inside one.
 *
 * Reads only, and no pagination: these are the axes other screens are drawn
 * against. A property has tens of rooms and a handful of types, and the grid
 * needs the whole axis rather than a page of it — the `{ items, total }`
 * contract belongs to `DataTable`, which is a different question.
 */

type Db = typeof prisma;

/**
 * A row named by id has to belong to the property in the URL. Without this an
 * id from another tenant would be edited by a procedure that had only checked
 * membership of the property it was *told* about.
 */
async function assertOwned(db: Db, kind: "roomType" | "room", id: number, propertyId: number) {
  const found =
    kind === "room"
      ? await db.room.count({ where: { id, propertyId } })
      : await db.roomType.count({ where: { id, propertyId } });

  if (found === 0) {
    throw kind === "room"
      ? new NotFoundError(PropertyError.ROOM_NOT_FOUND, "Room not found")
      : new NotFoundError(PropertyError.ROOM_TYPE_NOT_FOUND, "Room type not found");
  }
}

/** `@@unique([propertyId, code])`, refused as a sentence rather than a 500. */
async function assertCodeFree(db: Db, propertyId: number, code: string, exceptId?: number) {
  const clash = await db.roomType.findFirst({
    where: { propertyId, code, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError(
      PropertyError.ROOM_TYPE_CODE_TAKEN,
      "That code is already used in this property",
      "code"
    );
  }
}

/** `@@unique([propertyId, number])`, same reason. */
async function assertNumberFree(db: Db, propertyId: number, number: string, exceptId?: number) {
  const clash = await db.room.findFirst({
    where: { propertyId, number, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError(
      PropertyError.ROOM_NUMBER_TAKEN,
      "That room number is already used",
      "number"
    );
  }
}

/**
 * Whether a room still owes someone a night.
 *
 * Cancelled and no-show released the room, and a stay that has departed is
 * history — what blocks a change is a booking whose last night is still ahead,
 * counted in the property's own day.
 */
async function hasLiveStays(db: Db, propertyId: number, roomId: number): Promise<boolean> {
  const property = await db.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: { timezone: true },
  });

  const live = await db.roomStay.count({
    where: {
      roomId,
      status: { notIn: [...GRID_HIDDEN_STATUSES] },
      checkOut: { gt: todayAt(property.timezone) },
    },
  });
  return live > 0;
}

/** Archived rows are filtered out of every list unless asked for by name. */
function archiveFilter(includeArchived: boolean | undefined) {
  return includeArchived ? {} : { archivedAt: null };
}

export const propertyRouter = createTRPCRouter({
  list: protectedProcedure.input(listPropertiesSchema).query(async ({ ctx, input }) => {
    await requireOrgMember(ctx, input.organizationId);

    return ctx.db.property.findMany({
      where: {
        organizationId: input.organizationId,
        ...archiveFilter(input.includeArchived),
        ...(input.search ? { name: { contains: input.search, mode: "insensitive" } } : {}),
      },
      orderBy: { name: "asc" },
      select: PROPERTY_ROUTE_SELECT,
    });
  }),

  /**
   * A new hotel, with the numbers it cannot operate without.
   *
   * **Both series are written in the same transaction.** A legal number comes
   * from a sequence, and a property missing one of these is a property that can
   * be booked into and never checked out of — which is exactly how it was
   * discovered: the seed wrote both and a test fixture wrote one.
   *
   * The counters start at zero and the period is this year; `nextSeriesNumber`
   * resets a yearly series when the year turns, so seeding a period now does
   * not date the property.
   */
  create: protectedProcedure.input(createPropertySchema).mutation(async ({ ctx, input }) => {
    const { role, user } = await requireOrgMember(ctx, input.organizationId);
    if (!canManageProperties(role)) {
      throw new ForbiddenError(PropertyError.MANAGER_REQUIRED, "Only managers can add a property");
    }

    const taken = await ctx.db.property.findFirst({
      where: { organizationId: input.organizationId, slug: input.slug },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictError(PropertyError.SLUG_TAKEN, "That slug is already used here", "slug");
    }

    const period = String(new Date().getUTCFullYear());
    const prefix = input.slug.slice(0, 3).toUpperCase();

    return ctx.db.property.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        slug: input.slug,
        timezone: input.timezone,
        currencyCode: input.currencyCode,
        checkInMinutes: input.checkInMinutes,
        checkOutMinutes: input.checkOutMinutes,
        createdById: user.id,
        updatedById: user.id,
        numberSeries: {
          create: [
            {
              organizationId: input.organizationId,
              kind: "RESERVATION",
              prefix: `${prefix}-`,
              period,
              counter: 0,
            },
            {
              organizationId: input.organizationId,
              kind: "FOLIO",
              prefix: `${prefix}-F-`,
              period,
              counter: 0,
            },
          ],
        },
      },
      select: PROPERTY_ROUTE_SELECT,
    });
  }),

  getBySlug: protectedProcedure.input(propertyBySlugSchema).query(async ({ ctx, input }) => {
    await requireOrgMember(ctx, input.organizationId);

    // The organization is part of the lookup, not checked after it: a property
    // from another tenant must be indistinguishable from one that is absent.
    const property = await ctx.db.property.findFirst({
      where: { organizationId: input.organizationId, slug: input.slug },
      select: PROPERTY_ROUTE_SELECT,
    });
    if (!property) {
      throw new NotFoundError(PropertyError.NOT_FOUND, "Property not found");
    }
    return property;
  }),

  /** What a guest actually books. Ordered as the property arranges them. */
  listRoomTypes: protectedProcedure.input(listRoomTypesSchema).query(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    return ctx.db.roomType.findMany({
      where: { propertyId: input.propertyId, ...archiveFilter(input.includeArchived) },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        baseOccupancy: true,
        maxOccupancy: true,
        maxAdults: true,
        maxChildren: true,
        position: true,
        archivedAt: true,
      },
    });
  }),

  /**
   * The rooms themselves. Columns are named rather than taken wholesale: this
   * is one row per room on a screen that draws sixty of them, so adding a
   * column should be a decision.
   *
   * `roomTypeId` travels as a scalar and `listRoomTypes` carries the rest — the
   * grid needs both lists anyway, and joining a type onto every room would send
   * the same ten rows sixty times.
   */
  listRooms: protectedProcedure.input(listRoomsSchema).query(async ({ ctx, input }) => {
    const scope = await requirePropertyMember(ctx, input.propertyId);

    const where: Prisma.RoomWhereInput = {
      propertyId: input.propertyId,
      ...archiveFilter(input.includeArchived),
      ...(input.roomTypeId ? { roomTypeId: input.roomTypeId } : {}),
      ...(input.status ? { status: input.status } : {}),
    };

    /**
     * The rooms, and whether each is for sale **tonight**.
     *
     * Two queries rather than one per room: the stays that cover tonight are
     * one bounded read, grouped in memory. The board learnt that lesson in
     * Phase 5 and it is cheaper to apply it than to rediscover it.
     */
    const tonight = todayAt(scope.property.timezone);
    const tomorrow = new Date(tonight.getTime() + 86_400_000);

    const [rooms, stays] = await Promise.all([
      ctx.db.room.findMany({
        where,
        select: {
          id: true,
          number: true,
          floor: true,
          status: true,
          roomTypeId: true,
          archivedAt: true,
        },
      }),
      ctx.db.roomStay.findMany({
        where: {
          room: { propertyId: input.propertyId },
          checkIn: { lt: tomorrow },
          checkOut: { gt: tonight },
        },
        select: { roomId: true, status: true },
      }),
    ]);

    const byRoom = new Map<number, { status: string }[]>();
    for (const stay of stays) {
      if (stay.roomId === null) continue;
      const found = byRoom.get(stay.roomId);
      if (found) found.push(stay);
      else byRoom.set(stay.roomId, [stay]);
    }

    // Sorted here, not in the query: room numbers are strings, so Postgres puts
    // 10 before 2. `compareRoomNumbers` is the corridor's order, and it is
    // tested without a database.
    return rooms
      .map((room) => ({ ...room, saleState: roomSaleState(byRoom.get(room.id) ?? []) }))
      .sort((a, b) => compareRoomNumbers(a.number, b.number));
  }),

  createRoomType: protectedProcedure
    .input(createRoomTypeSchema)
    .mutation(async ({ ctx, input }) => {
      const { user, role } = await requirePropertyMember(ctx, input.propertyId);
      if (!canManageRoomTypes(role)) {
        throw new ForbiddenError(
          PropertyError.ROOM_TYPE_CREATE_FORBIDDEN,
          "You cannot add room types"
        );
      }

      const refusal = refuseOccupancy(input);
      if (refusal) {
        throw refused(refusal, "invalid", "maxOccupancy");
      }
      await assertCodeFree(ctx.db, input.propertyId, input.code);

      return ctx.db.roomType.create({
        data: { ...input, createdById: user.id, updatedById: user.id },
      });
    }),

  updateRoomType: protectedProcedure
    .input(updateRoomTypeSchema)
    .mutation(async ({ ctx, input }) => {
      const { user, role } = await requirePropertyMember(ctx, input.propertyId);
      if (!canManageRoomTypes(role)) {
        throw new ForbiddenError(
          PropertyError.ROOM_TYPE_UPDATE_FORBIDDEN,
          "You cannot edit room types"
        );
      }

      const refusal = refuseOccupancy(input);
      if (refusal) {
        throw refused(refusal, "invalid", "maxOccupancy");
      }

      const { id, propertyId, ...data } = input;
      await assertOwned(ctx.db, "roomType", id, propertyId);
      await assertCodeFree(ctx.db, propertyId, data.code, id);

      return ctx.db.roomType.update({ where: { id }, data: { ...data, updatedById: user.id } });
    }),

  /**
   * Archiving withdraws a type from sale; it does not delete it, because the
   * stays already sold on it still have to be drawn. Rooms have to go first —
   * a type with rooms still on it is not withdrawn, it is hidden.
   */
  archiveRoomType: protectedProcedure
    .input(archiveInventorySchema)
    .mutation(async ({ ctx, input }) => {
      const { user, role } = await requirePropertyMember(ctx, input.propertyId);
      if (!canArchiveRoomTypes(role)) {
        throw new ForbiddenError(
          PropertyError.ROOM_TYPE_ARCHIVE_FORBIDDEN,
          "You cannot archive room types"
        );
      }
      await assertOwned(ctx.db, "roomType", input.id, input.propertyId);

      if (input.archived) {
        const live = await ctx.db.room.count({
          where: { roomTypeId: input.id, archivedAt: null },
        });
        if (live > 0) {
          throw new ConflictError(
            PropertyError.ROOM_TYPE_HAS_ROOMS,
            `Archive the ${live} room${live === 1 ? "" : "s"} on this type first`,
            "id"
          ).with({ count: live });
        }
      }

      return ctx.db.roomType.update({
        where: { id: input.id },
        data: { archivedAt: input.archived ? new Date() : null, updatedById: user.id },
      });
    }),

  createRoom: protectedProcedure.input(createRoomSchema).mutation(async ({ ctx, input }) => {
    const { user, role } = await requirePropertyMember(ctx, input.propertyId);
    if (!canManageRooms(role)) {
      throw new ForbiddenError(PropertyError.ROOM_CREATE_FORBIDDEN, "You cannot add rooms");
    }

    await assertOwned(ctx.db, "roomType", input.roomTypeId, input.propertyId);
    await assertNumberFree(ctx.db, input.propertyId, input.number);

    return ctx.db.room.create({
      data: { ...input, createdById: user.id, updatedById: user.id },
    });
  }),

  updateRoom: protectedProcedure.input(updateRoomSchema).mutation(async ({ ctx, input }) => {
    const { user, role } = await requirePropertyMember(ctx, input.propertyId);
    if (!canManageRooms(role)) {
      throw new ForbiddenError(PropertyError.ROOM_UPDATE_FORBIDDEN, "You cannot edit rooms");
    }

    const { id, propertyId, ...data } = input;
    const room = await ctx.db.room.findFirst({
      where: { id, propertyId },
      select: { id: true, roomTypeId: true },
    });
    if (!room) {
      throw new NotFoundError(PropertyError.ROOM_NOT_FOUND, "Room not found");
    }
    await assertOwned(ctx.db, "roomType", data.roomTypeId, propertyId);
    await assertNumberFree(ctx.db, propertyId, data.number, id);

    // `assignRoom` requires a stay's type and its room's type to agree, so
    // retyping a room that is already sold would break that pairing after the
    // fact rather than at the assignment.
    if (data.roomTypeId !== room.roomTypeId && (await hasLiveStays(ctx.db, propertyId, id))) {
      throw new ConflictError(
        PropertyError.ROOM_RETYPE_BLOCKED,
        "That room has bookings on its current type",
        "roomTypeId"
      );
    }

    return ctx.db.room.update({ where: { id }, data: { ...data, updatedById: user.id } });
  }),

  /**
   * Hold rooms back, or stop holding them back.
   *
   * The only thing `RoomTypeInventory` stores. How many rooms *exist* is
   * counted from the `Room` rows and never written here — a stored copy drifts
   * the moment somebody adds a room, and a property that had no rows at all was
   * sold out on every night for ever. A night with no row is every room.
   *
   * So this is not "declare your inventory"; it is "close the second floor in
   * March". `blockedRooms: 0` clears it, which is how the floor reopens, and
   * the row is deleted rather than zeroed: a table whose meaning is *somebody
   * held rooms back here* should not be full of rows saying nobody did.
   *
   * Manager-only, with rate-setting as the precedent rather than check-in:
   * withdrawing rooms from sale is a commercial act, and a shift that can do it
   * by accident is a shift that can lose a week of bookings.
   */
  setBlock: protectedProcedure.input(setRoomBlockSchema).mutation(async ({ ctx, input }) => {
    const scope = await requirePropertyMember(ctx, input.propertyId);
    const role = scope.role;
    if (!canManageRooms(role)) {
      throw new ForbiddenError(PropertyError.BLOCK_FORBIDDEN, "You cannot block rooms");
    }
    await assertOwned(ctx.db, "roomType", input.roomTypeId, input.propertyId);

    const nights = nightsOf({ checkIn: input.from, checkOut: input.to });
    const totalRooms = await ctx.db.room.count({
      where: { roomTypeId: input.roomTypeId, archivedAt: null },
    });

    // The rule is a pure function in `model/`; this is the arithmetic it reads
    // and the sentence it refuses with, which is the one the screen shows.
    const refusal = refuseBlock({
      blockedRooms: input.blockedRooms,
      totalRooms,
      nights: nights.length,
    });
    if (refusal) {
      throw refused(refusal);
    }

    // One transaction: a half-applied block is a range where some nights are
    // closed and some are not, which nobody can see and everybody has to
    // discover by failing to sell.
    return ctx.db.$transaction(async (tx) => {
      if (input.blockedRooms === 0) {
        const { count } = await tx.roomTypeInventory.deleteMany({
          where: { roomTypeId: input.roomTypeId, date: { in: nights } },
        });
        return { nights: nights.length, cleared: count };
      }

      for (const date of nights) {
        await tx.roomTypeInventory.upsert({
          where: { roomTypeId_date: { roomTypeId: input.roomTypeId, date } },
          update: { blockedRooms: input.blockedRooms, reason: input.reason ?? null },
          create: {
            roomTypeId: input.roomTypeId,
            date,
            blockedRooms: input.blockedRooms,
            reason: input.reason ?? null,
          },
        });
      }

      // What is for sale changed, so the channels are owed the diff — in the
      // transaction that changed it, not after.
      await enqueueChannelPush(tx, {
        propertyId: input.propertyId,
        organizationId: scope.member.organizationId,
        from: nights[0],
      });

      return { nights: nights.length, cleared: 0 };
    });
  }),

  archiveRoom: protectedProcedure.input(archiveInventorySchema).mutation(async ({ ctx, input }) => {
    const { user, role } = await requirePropertyMember(ctx, input.propertyId);
    if (!canArchiveRooms(role)) {
      throw new ForbiddenError(PropertyError.ROOM_ARCHIVE_FORBIDDEN, "You cannot archive rooms");
    }
    await assertOwned(ctx.db, "room", input.id, input.propertyId);

    if (input.archived && (await hasLiveStays(ctx.db, input.propertyId, input.id))) {
      throw new ConflictError(
        PropertyError.ROOM_ARCHIVE_BLOCKED,
        "That room has bookings that have not left yet",
        "id"
      );
    }

    return ctx.db.room.update({
      where: { id: input.id },
      data: { archivedAt: input.archived ? new Date() : null, updatedById: user.id },
    });
  }),
});
