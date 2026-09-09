import "server-only";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/server/db";
import { fieldError } from "@/server/errors";
import { requireOrgMember } from "@/server/auth";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
// A room cannot be archived out from under a booking, and only reservations
// knows which statuses still hold one. The constants are model-side, so this is
// a read of a shared definition rather than a reach into another feature.
import { GRID_HIDDEN_STATUSES, todayAt } from "@/features/reservations";
import {
  archiveInventorySchema,
  canArchiveRooms,
  canArchiveRoomTypes,
  canManageRooms,
  canManageRoomTypes,
  compareRoomNumbers,
  createRoomSchema,
  createRoomTypeSchema,
  refuseOccupancy,
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
    throw new TRPCError({
      code: "NOT_FOUND",
      message: kind === "room" ? "Room not found" : "Room type not found",
    });
  }
}

/** `@@unique([propertyId, code])`, refused as a sentence rather than a 500. */
async function assertCodeFree(db: Db, propertyId: number, code: string, exceptId?: number) {
  const clash = await db.roomType.findFirst({
    where: { propertyId, code, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    throw fieldError("code", "That code is already used in this property", "CONFLICT");
  }
}

/** `@@unique([propertyId, number])`, same reason. */
async function assertNumberFree(db: Db, propertyId: number, number: string, exceptId?: number) {
  const clash = await db.room.findFirst({
    where: { propertyId, number, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    throw fieldError("number", "That room number is already used", "CONFLICT");
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

  getBySlug: protectedProcedure.input(propertyBySlugSchema).query(async ({ ctx, input }) => {
    await requireOrgMember(ctx, input.organizationId);

    // The organization is part of the lookup, not checked after it: a property
    // from another tenant must be indistinguishable from one that is absent.
    const property = await ctx.db.property.findFirst({
      where: { organizationId: input.organizationId, slug: input.slug },
      select: PROPERTY_ROUTE_SELECT,
    });
    if (!property) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Property not found" });
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
    await requirePropertyMember(ctx, input.propertyId);

    const where: Prisma.RoomWhereInput = {
      propertyId: input.propertyId,
      ...archiveFilter(input.includeArchived),
      ...(input.roomTypeId ? { roomTypeId: input.roomTypeId } : {}),
      ...(input.status ? { status: input.status } : {}),
    };

    const rooms = await ctx.db.room.findMany({
      where,
      select: {
        id: true,
        number: true,
        floor: true,
        status: true,
        roomTypeId: true,
        archivedAt: true,
      },
    });

    // Sorted here, not in the query: room numbers are strings, so Postgres puts
    // 10 before 2. `compareRoomNumbers` is the corridor's order, and it is
    // tested without a database.
    return rooms.sort((a, b) => compareRoomNumbers(a.number, b.number));
  }),

  createRoomType: protectedProcedure
    .input(createRoomTypeSchema)
    .mutation(async ({ ctx, input }) => {
      const { user, role } = await requirePropertyMember(ctx, input.propertyId);
      if (!canManageRoomTypes(role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot add room types" });
      }

      const refusal = refuseOccupancy(input);
      if (refusal) {
        throw fieldError("maxOccupancy", refusal, "BAD_REQUEST");
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
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot edit room types" });
      }

      const refusal = refuseOccupancy(input);
      if (refusal) {
        throw fieldError("maxOccupancy", refusal, "BAD_REQUEST");
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
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot archive room types" });
      }
      await assertOwned(ctx.db, "roomType", input.id, input.propertyId);

      if (input.archived) {
        const live = await ctx.db.room.count({
          where: { roomTypeId: input.id, archivedAt: null },
        });
        if (live > 0) {
          throw fieldError(
            "id",
            `Archive the ${live} room${live === 1 ? "" : "s"} on this type first`,
            "CONFLICT"
          );
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
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot add rooms" });
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
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot edit rooms" });
    }

    const { id, propertyId, ...data } = input;
    const room = await ctx.db.room.findFirst({
      where: { id, propertyId },
      select: { id: true, roomTypeId: true },
    });
    if (!room) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
    }
    await assertOwned(ctx.db, "roomType", data.roomTypeId, propertyId);
    await assertNumberFree(ctx.db, propertyId, data.number, id);

    // `assignRoom` requires a stay's type and its room's type to agree, so
    // retyping a room that is already sold would break that pairing after the
    // fact rather than at the assignment.
    if (data.roomTypeId !== room.roomTypeId && (await hasLiveStays(ctx.db, propertyId, id))) {
      throw fieldError("roomTypeId", "That room has bookings on its current type", "CONFLICT");
    }

    return ctx.db.room.update({ where: { id }, data: { ...data, updatedById: user.id } });
  }),

  archiveRoom: protectedProcedure.input(archiveInventorySchema).mutation(async ({ ctx, input }) => {
    const { user, role } = await requirePropertyMember(ctx, input.propertyId);
    if (!canArchiveRooms(role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot archive rooms" });
    }
    await assertOwned(ctx.db, "room", input.id, input.propertyId);

    if (input.archived && (await hasLiveStays(ctx.db, input.propertyId, input.id))) {
      throw fieldError("id", "That room has bookings that have not left yet", "CONFLICT");
    }

    return ctx.db.room.update({
      where: { id: input.id },
      data: { archivedAt: input.archived ? new Date() : null, updatedById: user.id },
    });
  }),
});
