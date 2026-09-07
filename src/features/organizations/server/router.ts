import "server-only";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { requireOrgManager, requireOrgMember, requireOrgOwner, requireUser } from "@/server/auth";
import { memberNotFound } from "@/server/errors";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import {
  OrgRole,
  addMemberSchema,
  assignableOrgRoleSchema,
  createOrganizationSchema,
  listOrganizationsSchema,
  updateOrganizationSchema,
} from "../model";
import { assertSlugAvailable, createOrganizationWithOwner, transferOwnership } from "./service";

/**
 * Organizations feature — the container the rest of the domain hangs off.
 * Owns `organizations.prisma` (Organization, OrganizationMember).
 *
 * Every procedure is scoped by membership, never by id alone: the guards in
 * `@/server/auth` resolve "who is asking" and "what may they do here" in one
 * call, so a router that forgets to check cannot compile into something that
 * silently works.
 */

const MEMBER_SELECT = {
  id: true,
  role: true,
  joinedAt: true,
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.OrganizationMemberSelect;

export const organizationRouter = createTRPCRouter({
  create: protectedProcedure.input(createOrganizationSchema).mutation(async ({ ctx, input }) => {
    const user = await requireUser(ctx);
    return createOrganizationWithOwner(ctx.db, { ...input, ownerId: user.id });
  }),

  /** Every organization the caller belongs to, with their role in each. */
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const user = await requireUser(ctx);

    const memberships = await ctx.db.organizationMember.findMany({
      where: { userId: user.id },
      include: {
        organization: { include: { _count: { select: { members: true } } } },
      },
      orderBy: { organization: { name: "asc" } },
    });

    return memberships.map(({ organization, role }) => ({
      ...organization,
      memberCount: organization._count.members,
      currentUserRole: role as OrgRole,
    }));
  }),

  /**
   * The paginated, sorted, filtered list behind the organizations table.
   *
   * `useDataTable` runs in manual mode, so paging, sorting and filtering all
   * happen here rather than in the browser. It queries `OrganizationMember`
   * rather than `Organization` because the caller's own role is both a column
   * and a filter — reading it from the membership row means one query instead
   * of a list plus a per-row lookup.
   */
  list: protectedProcedure.input(listOrganizationsSchema).query(async ({ ctx, input }) => {
    const user = await requireUser(ctx);
    const { filter, orderBy, pagination } = input;

    const where: Prisma.OrganizationMemberWhereInput = {
      userId: user.id,
      ...(filter?.role?.length ? { role: { in: filter.role } } : {}),
      ...(filter?.name || filter?.slug
        ? {
            organization: {
              // SQLite has no `mode: "insensitive"`; `contains` is already
              // case-insensitive there for ASCII. On Postgres, add it.
              ...(filter.name ? { name: { contains: filter.name } } : {}),
              ...(filter.slug ? { slug: { contains: filter.slug } } : {}),
            },
          }
        : {}),
    };

    const orderByClause: Prisma.OrganizationMemberOrderByWithRelationInput = orderBy
      ? { organization: { [orderBy.field]: orderBy.direction } }
      : { organization: { name: "asc" } };

    const [rows, total] = await Promise.all([
      ctx.db.organizationMember.findMany({
        where,
        orderBy: orderByClause,
        skip: pagination.skip,
        take: pagination.take,
        include: {
          organization: { include: { _count: { select: { members: true } } } },
        },
      }),
      ctx.db.organizationMember.count({ where }),
    ]);

    return {
      items: rows.map(({ organization, role }) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        description: organization.description,
        createdAt: organization.createdAt,
        memberCount: organization._count.members,
        currentUserRole: role as OrgRole,
      })),
      total,
      meta: { skip: pagination.skip, take: pagination.take },
    };
  }),

  /**
   * Paginated search over the caller's own organizations — the shape
   * `ComboBox`'s `searchFn` expects (`{ search, offset, size }` in, a flat
   * array out).
   */
  search: protectedProcedure
    .input(
      z.object({
        search: z.string().default(""),
        offset: z.number().min(0).default(0),
        size: z.number().min(1).max(50).default(25),
      })
    )
    .query(async ({ ctx, input }) => {
      const user = await requireUser(ctx);
      const organizations = await ctx.db.organization.findMany({
        where: {
          members: { some: { userId: user.id } },
          ...(input.search ? { name: { contains: input.search } } : {}),
        },
        orderBy: { name: "asc" },
        skip: input.offset,
        take: input.size,
      });
      return organizations.map((o) => ({ id: o.id, name: o.name, slug: o.slug }));
    }),

  getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const { role } = await requireOrgMember(ctx, input.id);

    const organization = await ctx.db.organization.findUnique({
      where: { id: input.id },
      include: { _count: { select: { members: true } } },
    });
    if (!organization) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
    }

    return {
      ...organization,
      memberCount: organization._count.members,
      currentUserRole: role,
    };
  }),

  update: protectedProcedure.input(updateOrganizationSchema).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    await requireOrgManager(ctx, id);

    if (data.slug) {
      await assertSlugAvailable(ctx.db, data.slug, id);
    }

    return ctx.db.organization.update({ where: { id }, data });
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgOwner(ctx, input.id);
      // Members cascade — see `onDelete: Cascade` in organizations.prisma.
      return ctx.db.organization.delete({ where: { id: input.id } });
    }),

  listMembers: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireOrgMember(ctx, input.organizationId);

      const members = await ctx.db.organizationMember.findMany({
        where: { organizationId: input.organizationId },
        select: MEMBER_SELECT,
        orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
      });

      return members.map((m) => ({ ...m, role: m.role as OrgRole }));
    }),

  /**
   * Add by email rather than by user id: an id is not something a person
   * has, and the invite flow people expect starts with an address. The user
   * must already exist — there is no pending-invite state in this template.
   */
  addMember: protectedProcedure.input(addMemberSchema).mutation(async ({ ctx, input }) => {
    await requireOrgManager(ctx, input.organizationId);

    const target = await ctx.db.user.findUnique({ where: { email: input.email } });
    if (!target) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No account with that email. They need to sign up first.",
      });
    }

    const existing = await ctx.db.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: input.organizationId, userId: target.id },
      },
    });
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "They are already a member" });
    }

    return ctx.db.organizationMember.create({
      data: {
        organizationId: input.organizationId,
        userId: target.id,
        role: input.role,
      },
      select: MEMBER_SELECT,
    });
  }),

  updateMemberRole: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        userId: z.string(),
        role: assignableOrgRoleSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx, input.organizationId);

      const target = await ctx.db.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.userId,
          },
        },
      });
      if (!target) {
        throw memberNotFound();
      }
      // The owner's role is not editable here — `transferOwnership` is the
      // only way it changes, and it moves both sides at once.
      if (target.role === OrgRole.OWNER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Transfer ownership instead of changing the owner's role",
        });
      }

      return ctx.db.organizationMember.update({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.userId,
          },
        },
        data: { role: input.role },
        select: MEMBER_SELECT,
      });
    }),

  removeMember: protectedProcedure
    .input(z.object({ organizationId: z.number(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { user } = await requireOrgManager(ctx, input.organizationId);

      if (input.userId === user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Use “Leave organization” to remove yourself",
        });
      }

      const target = await ctx.db.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.userId,
          },
        },
      });
      if (!target) {
        throw memberNotFound();
      }
      if (target.role === OrgRole.OWNER) {
        throw new TRPCError({ code: "FORBIDDEN", message: "The owner cannot be removed" });
      }

      return ctx.db.organizationMember.delete({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.userId,
          },
        },
      });
    }),

  /**
   * Leave, unless you are the owner — an organization with no owner has no
   * one who can delete it or hand it over, so the owner must transfer first
   * (or delete the whole thing).
   */
  leave: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { user, role } = await requireOrgMember(ctx, input.organizationId);

      if (role === OrgRole.OWNER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Transfer ownership or delete the organization before leaving",
        });
      }

      return ctx.db.organizationMember.delete({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: user.id,
          },
        },
      });
    }),

  transferOwnership: protectedProcedure
    .input(z.object({ organizationId: z.number(), toUserId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { user } = await requireOrgOwner(ctx, input.organizationId);

      if (input.toUserId === user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You already own this organization" });
      }

      await transferOwnership(ctx.db, input.organizationId, user.id, input.toUserId);
      return { ok: true };
    }),
});
