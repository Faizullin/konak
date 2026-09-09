import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser } from "@/server/auth";
import { InvalidError, userNotFound } from "@/server/errors";
import { adminProcedure, createTRPCRouter, protectedProcedure } from "@/server/trpc";
import {
  UserRole,
  couldRemoveLastAdmin,
  IdentityError,
  isLastAdmin,
  listUsersInputSchema,
  updateProfileInputSchema,
  userRoleSchema,
} from "../model";

/**
 * Identity feature — who the caller is. Better Auth owns the `User` table and
 * writes it directly; this router reads it and administers roles.
 */
export const userRouter = createTRPCRouter({
  /** The signed-in user's own row. The one call a client always needs. */
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    return requireUser(ctx);
  }),

  updateProfile: protectedProcedure
    .input(updateProfileInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await requireUser(ctx);

      return ctx.db.user.update({
        where: { id: user.id },
        data: { name: input.name },
      });
    }),

  adminList: adminProcedure.input(listUsersInputSchema).query(async ({ ctx, input }) => {
    const { filter, orderBy, pagination } = input;

    const where: Prisma.UserWhereInput = {};
    if (filter?.name) {
      where.name = { contains: filter.name };
    }
    if (filter?.email) {
      where.email = { contains: filter.email };
    }
    if (filter?.role) {
      where.role = filter.role;
    }

    const orderByClause: Prisma.UserOrderByWithRelationInput = orderBy
      ? { [orderBy.field]: orderBy.direction }
      : { createdAt: "desc" };

    const [items, total] = await Promise.all([
      ctx.db.user.findMany({
        where,
        orderBy: orderByClause,
        skip: pagination.skip,
        take: pagination.take,
      }),
      ctx.db.user.count({ where }),
    ]);

    return {
      items,
      total,
      meta: { skip: pagination.skip, take: pagination.take },
    };
  }),

  updateRole: adminProcedure
    .input(z.object({ id: z.string(), role: userRoleSchema }))
    .mutation(async ({ ctx, input }) => {
      // Demoting the final ADMIN leaves nobody who can reach this procedure
      // again: `adminProcedure` is the only way in, and it is the thing being
      // taken away. The check lives on the server rather than in the UI —
      // hiding the control is a courtesy, never the enforcement.
      //
      // The rule itself is in `model/`, where it is tested without a database.
      // What stays here is the two queries it needs and the throw.
      const target = await ctx.db.user.findUnique({ where: { id: input.id } });
      if (!target) {
        throw userNotFound();
      }

      if (couldRemoveLastAdmin(target.role, input.role)) {
        const otherAdminCount = await ctx.db.user.count({
          where: { role: UserRole.ADMIN, id: { not: input.id } },
        });
        if (isLastAdmin(otherAdminCount)) {
          throw new InvalidError(IdentityError.LAST_ADMIN, "Cannot demote the last admin");
        }
      }

      return ctx.db.user.update({
        where: { id: input.id },
        data: { role: input.role },
      });
    }),
});
