import "server-only";
import { TRPCError } from "@trpc/server";
import { requireOrgMember } from "@/server/auth";
import { newStorageKey } from "../model";
import { fieldError } from "@/server/errors";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import prisma from "@/server/db";
import {
  createActivitySchema,
  createAttachmentSchema,
  listAttachmentsSchema,
  createTagSchema,
  hasExactlyOneSubject,
  listActivitiesSchema,
  subjectOf,
  tagSubjectSchema,
  type SubjectRef,
} from "../model";

/**
 * The substrate: what happened, and what things are called.
 *
 * A subject is one nullable foreign key, exactly one set. SQLite had no CHECK
 * and Postgres cannot express this one either, so it is refused here — before
 * the insert, not after.
 */

/** Every subject must belong to the caller's organization; a stray id is a leak. */
async function assertSubjectInOrg(organizationId: number, ref: SubjectRef) {
  if (!hasExactlyOneSubject(ref)) {
    throw fieldError(
      "personId",
      "Attach this to exactly one person, company or property",
      "BAD_REQUEST"
    );
  }

  const subject = subjectOf(ref)!;
  const found =
    subject.kind === "person"
      ? await prisma.person.findFirst({ where: { id: subject.id, organizationId } })
      : subject.kind === "company"
        ? await prisma.company.findFirst({ where: { id: subject.id, organizationId } })
        : await prisma.property.findFirst({ where: { id: subject.id, organizationId } });

  if (!found) {
    throw new TRPCError({ code: "NOT_FOUND", message: "That subject was not found" });
  }
  return subject;
}

export const platformRouter = createTRPCRouter({
  listActivities: protectedProcedure.input(listActivitiesSchema).query(async ({ ctx, input }) => {
    await requireOrgMember(ctx, input.organizationId);
    await assertSubjectInOrg(input.organizationId, input);

    return ctx.db.activity.findMany({
      where: {
        organizationId: input.organizationId,
        personId: input.personId ?? undefined,
        companyId: input.companyId ?? undefined,
        propertyId: input.propertyId ?? undefined,
      },
      orderBy: { createdAt: "desc" },
      take: input.take,
    });
  }),

  createActivity: protectedProcedure
    .input(createActivitySchema)
    .mutation(async ({ ctx, input }) => {
      const { user } = await requireOrgMember(ctx, input.organizationId);
      await assertSubjectInOrg(input.organizationId, input);

      // The idempotency key is the whole point of allowing a client-supplied id:
      // a tablet that retries must not leave two notes.
      if (input.clientEventId) {
        const existing = await ctx.db.activity.findUnique({
          where: { clientEventId: input.clientEventId },
        });
        if (existing) return existing;
      }

      return ctx.db.activity.create({
        data: {
          organizationId: input.organizationId,
          type: input.type,
          subject: input.subject,
          body: input.body,
          dueAt: input.dueAt,
          personId: input.personId,
          companyId: input.companyId,
          propertyId: input.propertyId,
          ownerUserId: user.id,
          createdById: user.id,
          clientEventId: input.clientEventId,
        },
      });
    }),

  listAttachments: protectedProcedure.input(listAttachmentsSchema).query(async ({ ctx, input }) => {
    await requireOrgMember(ctx, input.organizationId);
    await assertSubjectInOrg(input.organizationId, input);

    return ctx.db.attachment.findMany({
      where: {
        organizationId: input.organizationId,
        personId: input.personId ?? undefined,
        companyId: input.companyId ?? undefined,
        propertyId: input.propertyId ?? undefined,
        revokedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
  }),

  /**
   * Reserves the row and its storage key. **The key is generated here**, never
   * accepted from a caller — that is the only way "random, not derived from an
   * id" can be guaranteed. The upload itself happens separately against the
   * returned key.
   */
  createAttachment: protectedProcedure
    .input(createAttachmentSchema)
    .mutation(async ({ ctx, input }) => {
      const { user } = await requireOrgMember(ctx, input.organizationId);
      await assertSubjectInOrg(input.organizationId, input);

      return ctx.db.attachment.create({
        data: {
          organizationId: input.organizationId,
          kind: input.kind,
          fileName: input.fileName,
          storageKey: newStorageKey(`org/${input.organizationId}/attachments`, input.fileName),
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          personId: input.personId,
          companyId: input.companyId,
          propertyId: input.propertyId,
          uploadedById: user.id,
        },
      });
    }),

  listTags: protectedProcedure
    .input(createTagSchema.pick({ organizationId: true }))
    .query(async ({ ctx, input }) => {
      await requireOrgMember(ctx, input.organizationId);
      return ctx.db.tag.findMany({
        where: { organizationId: input.organizationId },
        orderBy: { name: "asc" },
      });
    }),

  createTag: protectedProcedure.input(createTagSchema).mutation(async ({ ctx, input }) => {
    await requireOrgMember(ctx, input.organizationId);

    const existing = await ctx.db.tag.findFirst({
      where: { organizationId: input.organizationId, name: input.name },
      select: { id: true },
    });
    if (existing) {
      throw fieldError("name", "That tag already exists", "CONFLICT");
    }

    return ctx.db.tag.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        colour: input.colour,
      },
    });
  }),

  attachTag: protectedProcedure.input(tagSubjectSchema).mutation(async ({ ctx, input }) => {
    await requireOrgMember(ctx, input.organizationId);
    await assertSubjectInOrg(input.organizationId, input);

    const tag = await ctx.db.tag.findFirst({
      where: { id: input.tagId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!tag) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });
    }

    const already = await ctx.db.entityTag.findFirst({
      where: {
        tagId: input.tagId,
        personId: input.personId ?? undefined,
        companyId: input.companyId ?? undefined,
        propertyId: input.propertyId ?? undefined,
      },
    });
    if (already) return already;

    return ctx.db.entityTag.create({
      data: {
        tagId: input.tagId,
        personId: input.personId,
        companyId: input.companyId,
        propertyId: input.propertyId,
      },
    });
  }),

  detachTag: protectedProcedure.input(tagSubjectSchema).mutation(async ({ ctx, input }) => {
    await requireOrgMember(ctx, input.organizationId);
    await assertSubjectInOrg(input.organizationId, input);

    await ctx.db.entityTag.deleteMany({
      where: {
        tagId: input.tagId,
        personId: input.personId ?? undefined,
        companyId: input.companyId ?? undefined,
        propertyId: input.propertyId ?? undefined,
      },
    });
    return { detached: true };
  }),
});
