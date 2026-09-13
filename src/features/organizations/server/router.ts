import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { requireOrgManager, requireOrgMember, requireOrgOwner, requireUser } from "@/server/auth";
import {
  ConflictError,
  ForbiddenError,
  InvalidError,
  memberNotFound,
  noOrgAccess,
  NotFoundError,
} from "@/server/errors";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { like } from "@/server/search";
import { enqueueStorageRemoval } from "@/features/platform/server";
import {
  OrgRole,
  OrganizationError,
  addMemberSchema,
  assignableOrgRoleSchema,
  createOrganizationSchema,
  listOrganizationsSchema,
  updateOrganizationSchema,
} from "../model";
import { assertSlugAvailable, createOrganizationWithOwner, transferOwnership } from "./service";
import { AuditAction } from "@/features/platform";
import { writeAudit } from "@/features/platform/server";

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
              ...(filter.name ? { name: like(filter.name) } : {}),
              ...(filter.slug ? { slug: like(filter.slug) } : {}),
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
          ...(input.search ? { name: like(input.search) } : {}),
        },
        orderBy: { name: "asc" },
        skip: input.offset,
        take: input.size,
      });
      return organizations.map((o) => ({ id: o.id, name: o.name, slug: o.slug }));
    }),

  /**
   * What the sidebar needs to draw an organization's nav: the caller's role in
   * it, and which modules it has switched on. One query rather than two,
   * because the shell asks on every navigation.
   */
  moduleAccess: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      /**
       * One round trip, which is what the comment above has always claimed.
       *
       * It was three, strictly sequential — the organization by slug, then the
       * membership, then the toggles — on a query the shell runs on **every
       * navigation**. All three are one row and its two relations, so they are
       * one query.
       *
       * This is the only place outside `requireOrgMember` that decides whether
       * somebody is a member, which is why the refusal is `noOrgAccess()` and
       * not a second sentence: one place to change the words, one to change the
       * code.
       */
      const organization = await ctx.db.organization.findUnique({
        where: { slug: input.slug },
        select: {
          id: true,
          members: {
            where: { userId: ctx.session.user.id },
            select: { role: true },
            take: 1,
          },
          organizationModules: { select: { moduleId: true, enabled: true } },
        },
      });
      if (!organization) {
        throw new NotFoundError(OrganizationError.NOT_FOUND, "Organization not found");
      }

      const membership = organization.members[0];
      if (!membership) {
        throw noOrgAccess();
      }

      return {
        organizationId: organization.id,
        role: membership.role as OrgRole,
        toggles: organization.organizationModules,
      };
    }),

  getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const { role } = await requireOrgMember(ctx, input.id);

    const organization = await ctx.db.organization.findUnique({
      where: { id: input.id },
      include: { _count: { select: { members: true } } },
    });
    if (!organization) {
      throw new NotFoundError(OrganizationError.NOT_FOUND, "Organization not found");
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

      return ctx.db.$transaction(async (tx) => {
        /**
         * Rows cascade — `onDelete: Cascade` in organizations.prisma — but bytes
         * do not, and afterwards nothing knows the keys. Filed first, and with a
         * null organizationId; `enqueueStorageRemoval` says why.
         *
         * **Read a page at a time**, because the alternative is loading every
         * attachment a tenant ever uploaded into memory to build one list. The
         * transaction is long either way — it holds the cascade — and this at
         * least bounds what is held *in the process*.
         */
        const PAGE = 1_000;
        let cursor: number | undefined;

        for (;;) {
          const page = await tx.attachment.findMany({
            where: { organizationId: input.id },
            select: { id: true, storageKey: true, provider: true, providerId: true },
            orderBy: { id: "asc" },
            take: PAGE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (page.length === 0) break;

          await enqueueStorageRemoval(tx, page);
          if (page.length < PAGE) break;
          cursor = page.at(-1)!.id;
        }

        /**
         * Filed before the rows go, and it outlives them.
         *
         * `AuditLog.organizationId` has no foreign key precisely for this: the
         * record of who deleted a tenant is the row most worth keeping, and it
         * used to be the first casualty of the cascade.
         */
        await writeAudit(tx, {
          organizationId: input.id,
          actorUserId: ctx.session.user.id,
          action: AuditAction.DELETE,
          entityType: "Organization",
          entityId: String(input.id),
          summary: "Organization deleted",
          ipAddress: ctx.ipAddress,
        });

        return tx.organization.delete({ where: { id: input.id } });
      });
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
      throw new NotFoundError(
        OrganizationError.MEMBER_NO_ACCOUNT,
        "No account with that email. They need to sign up first."
      );
    }

    const existing = await ctx.db.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: input.organizationId, userId: target.id },
      },
    });
    if (existing) {
      throw new ConflictError(
        OrganizationError.MEMBER_ALREADY,
        "They are already a member",
        "email"
      );
    }

    return ctx.db.$transaction(async (tx) => {
      const created = await tx.organizationMember.create({
        data: {
          organizationId: input.organizationId,
          userId: target.id,
          role: input.role,
        },
        select: MEMBER_SELECT,
      });

      await writeAudit(tx, {
        organizationId: input.organizationId,
        actorUserId: ctx.session.user.id,
        action: AuditAction.CREATE,
        entityType: "OrganizationMember",
        entityId: target.id,
        summary: `${input.email} added as ${input.role}`,
        ipAddress: ctx.ipAddress,
        after: { role: input.role },
      });

      return created;
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
        throw new InvalidError(
          OrganizationError.MEMBER_OWNER_ROLE_LOCKED,
          "Transfer ownership instead of changing the owner's role"
        );
      }

      /**
       * The change and the record of it, together.
       *
       * A role change is the act `createdById`/`updatedById` cannot describe:
       * the row afterwards says who touched it last, never what it used to be
       * or who it was done to. This is the OWASP category that matters most —
       * privilege changes — and it is why the audit row carries the *before*.
       */
      return ctx.db.$transaction(async (tx) => {
        const updated = await tx.organizationMember.update({
          where: {
            organizationId_userId: {
              organizationId: input.organizationId,
              userId: input.userId,
            },
          },
          data: { role: input.role },
          select: MEMBER_SELECT,
        });

        await writeAudit(tx, {
          organizationId: input.organizationId,
          actorUserId: ctx.session.user.id,
          action: AuditAction.UPDATE,
          entityType: "OrganizationMember",
          entityId: input.userId,
          summary: `Role changed from ${target.role} to ${input.role}`,
          ipAddress: ctx.ipAddress,
          before: target,
          after: { role: input.role },
        });

        return updated;
      });
    }),

  removeMember: protectedProcedure
    .input(z.object({ organizationId: z.number(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { user } = await requireOrgManager(ctx, input.organizationId);

      if (input.userId === user.id) {
        throw new InvalidError(
          OrganizationError.MEMBER_REMOVE_SELF,
          "Use “Leave organization” to remove yourself"
        );
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
        throw new ForbiddenError(
          OrganizationError.MEMBER_OWNER_NOT_REMOVABLE,
          "The owner cannot be removed"
        );
      }

      // The row is about to stop existing, so the trail is the only thing that
      // will remember it did — and `actorUserId` is a user id with no foreign
      // key precisely so this survives the actor leaving too.
      return ctx.db.$transaction(async (tx) => {
        const removed = await tx.organizationMember.delete({
          where: {
            organizationId_userId: {
              organizationId: input.organizationId,
              userId: input.userId,
            },
          },
        });

        await writeAudit(tx, {
          organizationId: input.organizationId,
          actorUserId: user.id,
          action: AuditAction.DELETE,
          entityType: "OrganizationMember",
          entityId: input.userId,
          summary: `Removed a ${target.role}`,
          ipAddress: ctx.ipAddress,
          before: target,
        });

        return removed;
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
        throw new InvalidError(
          OrganizationError.OWNER_CANNOT_LEAVE,
          "Transfer ownership or delete the organization before leaving"
        );
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
        throw new InvalidError(
          OrganizationError.ALREADY_OWNER,
          "You already own this organization"
        );
      }

      await transferOwnership(ctx.db, input.organizationId, user.id, input.toUserId);
      return { ok: true };
    }),
});
