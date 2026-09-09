import "server-only";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@/generated/prisma/client";
import { requireOrgMember } from "@/server/auth";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import {
  compareRoomNumbers,
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
});
