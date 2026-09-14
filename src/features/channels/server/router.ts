import "server-only";
import { ConflictError, ForbiddenError, NotFoundError, PreconditionError } from "@/server/errors";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { canManageProperties } from "@/features/properties";
import { requirePropertyMember } from "@/features/properties/server";
import {
  ChannelError,
  ChannelStatus,
  createConnectionSchema,
  listConnectionsSchema,
  mapRoomTypeSchema,
  setConnectionCredentialsSchema,
  setConnectionStatusSchema,
  unmapRoomTypeSchema,
} from "../model";
import { channelSecretReadable } from "./credentials";
import { enqueueChannelPush } from "./enqueue";

/**
 * Connecting a channel, and mapping what it calls our rooms.
 *
 * Manager-only throughout: deciding where a hotel sells is the same kind of
 * decision as deciding what it charges, and a receptionist mapping a room type
 * mid-shift would put a category on sale nobody chose.
 */

export const channelRouter = createTRPCRouter({
  list: protectedProcedure.input(listConnectionsSchema).query(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    const connections = await ctx.db.channelConnection.findMany({
      where: { propertyId: input.propertyId },
      orderBy: { channelCode: "asc" },
      select: {
        id: true,
        provider: true,
        channelCode: true,
        status: true,
        credentialsRef: true,
        externalPropertyId: true,
        lastSyncedAt: true,
        lastError: true,
        mappings: {
          select: {
            id: true,
            roomTypeId: true,
            ratePlanId: true,
            externalRoomTypeId: true,
            externalRatePlanId: true,
            isActive: true,
            roomType: { select: { name: true } },
          },
          orderBy: { id: "asc" },
        },
      },
    });

    // Whether the secret each ref names can actually be read, answered here so
    // a manager learns a name is wrong while typing it rather than when a push
    // dead-letters overnight. Yes or no only — the path and the reason belong
    // in the dead letter, not on a screen.
    return Promise.all(
      connections.map(async (connection) => ({
        ...connection,
        credentialsPresent: await channelSecretReadable(connection.credentialsRef),
      }))
    );
  }),

  create: protectedProcedure.input(createConnectionSchema).mutation(async ({ ctx, input }) => {
    const { role, user } = await requirePropertyMember(ctx, input.propertyId);
    if (!canManageProperties(role)) {
      throw new ForbiddenError("property.manager_required", "Only managers can connect a channel");
    }

    const taken = await ctx.db.channelConnection.findFirst({
      where: { propertyId: input.propertyId, channelCode: input.channelCode },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictError(
        ChannelError.CONNECTION_EXISTS,
        "That channel is already connected to this property",
        "channelCode"
      );
    }

    // Paused on creation, always. A connection that started selling the moment
    // it was saved would push before anybody mapped a room type — and absent
    // means off, so that push would say every type is closed.
    return ctx.db.channelConnection.create({
      data: {
        propertyId: input.propertyId,
        provider: input.provider,
        channelCode: input.channelCode,
        externalPropertyId: input.externalPropertyId,
        credentialsRef: input.credentialsRef,
        status: ChannelStatus.PAUSED,
        createdById: user.id,
      },
    });
  }),

  setStatus: protectedProcedure
    .input(setConnectionStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const { property, role } = await requirePropertyMember(ctx, input.propertyId);
      if (!canManageProperties(role)) {
        throw new ForbiddenError("property.manager_required", "Only managers can do that");
      }

      const connection = await ctx.db.channelConnection.findFirst({
        where: { id: input.id, propertyId: input.propertyId },
        select: { id: true, credentialsRef: true },
      });
      if (!connection) {
        throw new NotFoundError(ChannelError.CONNECTION_NOT_FOUND, "Connection not found");
      }

      // Refused here rather than discovered at the drain. Switching on enqueues
      // a push of everything, and an ACTIVE connection whose secret cannot be
      // read produces a dead letter per task until somebody reads the queue —
      // where this is one sentence on the screen of the person who can fix it.
      if (
        input.status === ChannelStatus.ACTIVE &&
        !(await channelSecretReadable(connection.credentialsRef))
      ) {
        throw new PreconditionError(
          ChannelError.CREDENTIALS_MISSING,
          "That connection has no readable credentials"
        );
      }

      return ctx.db.$transaction(async (tx) => {
        const updated = await tx.channelConnection.update({
          where: { id: connection.id },
          data: { status: input.status, lastError: null },
        });

        // Switched on, the channel knows nothing yet — there is no mirror, so
        // the first diff is everything, which is exactly right.
        if (input.status === ChannelStatus.ACTIVE) {
          await enqueueChannelPush(tx, {
            propertyId: input.propertyId,
            organizationId: property.organizationId,
          });
        }

        return updated;
      });
    }),

  /**
   * Where this connection's secret lives now.
   *
   * Its own mutation because rotating a key is the ordinary case, and
   * re-creating the connection to do it would throw away the mappings and the
   * mirror — the record of what the channel has already been told.
   */
  setCredentials: protectedProcedure
    .input(setConnectionCredentialsSchema)
    .mutation(async ({ ctx, input }) => {
      const { role } = await requirePropertyMember(ctx, input.propertyId);
      if (!canManageProperties(role)) {
        throw new ForbiddenError("property.manager_required", "Only managers can do that");
      }

      const connection = await ctx.db.channelConnection.findFirst({
        where: { id: input.id, propertyId: input.propertyId },
        select: { id: true },
      });
      if (!connection) {
        throw new NotFoundError(ChannelError.CONNECTION_NOT_FOUND, "Connection not found");
      }

      return ctx.db.channelConnection.update({
        where: { id: connection.id },
        data: {
          credentialsRef: input.credentialsRef ?? null,
          externalPropertyId: input.externalPropertyId ?? null,
          // The old failure described the old credentials.
          lastError: null,
        },
      });
    }),

  /**
   * What this channel calls one of our room types.
   *
   * **Absent means off.** A type with no mapping row is simply not distributed,
   * so a room type added next month is never accidentally on sale everywhere.
   */
  map: protectedProcedure.input(mapRoomTypeSchema).mutation(async ({ ctx, input }) => {
    const { property, role } = await requirePropertyMember(ctx, input.propertyId);
    if (!canManageProperties(role)) {
      throw new ForbiddenError("property.manager_required", "Only managers can map room types");
    }

    const [connection, roomType] = await Promise.all([
      ctx.db.channelConnection.findFirst({
        where: { id: input.connectionId, propertyId: input.propertyId },
        select: { id: true },
      }),
      ctx.db.roomType.findFirst({
        where: { id: input.roomTypeId, propertyId: input.propertyId },
        select: { id: true },
      }),
    ]);
    if (!connection) {
      throw new NotFoundError(ChannelError.CONNECTION_NOT_FOUND, "Connection not found");
    }
    if (!roomType) {
      throw new NotFoundError("room_type.not_found", "Room type not found");
    }

    return ctx.db.$transaction(async (tx) => {
      // Find-then-write rather than `upsert`: the compound unique carries a
      // nullable `ratePlanId`, and a mapping for "this type on any plan" is the
      // ordinary case — Prisma's compound `where` cannot express the null.
      const existing = await tx.channelMapping.findFirst({
        where: {
          connectionId: input.connectionId,
          roomTypeId: input.roomTypeId,
          ratePlanId: input.ratePlanId ?? null,
        },
        select: { id: true },
      });

      const mapping = existing
        ? await tx.channelMapping.update({
            where: { id: existing.id },
            data: {
              externalRoomTypeId: input.externalRoomTypeId,
              externalRatePlanId: input.externalRatePlanId,
              // Re-mapping a type somebody unmapped is how it comes back.
              isActive: true,
            },
          })
        : await tx.channelMapping.create({
            data: {
              connectionId: input.connectionId,
              roomTypeId: input.roomTypeId,
              ratePlanId: input.ratePlanId,
              externalRoomTypeId: input.externalRoomTypeId,
              externalRatePlanId: input.externalRatePlanId,
            },
          });

      // A type that just became distributable has never been pushed, so the
      // diff has everything to say about it.
      await enqueueChannelPush(tx, {
        propertyId: input.propertyId,
        organizationId: property.organizationId,
      });

      return mapping;
    });
  }),

  unmap: protectedProcedure.input(unmapRoomTypeSchema).mutation(async ({ ctx, input }) => {
    const { property, role } = await requirePropertyMember(ctx, input.propertyId);
    if (!canManageProperties(role)) {
      throw new ForbiddenError("property.manager_required", "Only managers can do that");
    }

    const mapping = await ctx.db.channelMapping.findFirst({
      where: { id: input.id, connection: { propertyId: input.propertyId } },
      select: { id: true },
    });
    if (!mapping) {
      throw new NotFoundError(ChannelError.MAPPING_NOT_FOUND, "Mapping not found");
    }

    return ctx.db.$transaction(async (tx) => {
      // Deactivated rather than deleted: the mirror rows written against it are
      // evidence of what the channel was told, and `nightsToClose` needs the
      // type to stop appearing in `current` while its history survives.
      const updated = await tx.channelMapping.update({
        where: { id: mapping.id },
        data: { isActive: false },
      });

      await enqueueChannelPush(tx, {
        propertyId: input.propertyId,
        organizationId: property.organizationId,
      });

      return updated;
    });
  }),
});
