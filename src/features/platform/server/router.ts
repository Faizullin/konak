import "server-only";
import { z } from "zod";
import { requireOrgMember } from "@/server/auth";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "@/server/errors";
import { canDeleteAttachments, canUploadAttachments } from "@/features/organizations";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import prisma from "@/server/db";
import {
  AttachmentStatus,
  confirmUploadSchema,
  createActivitySchema,
  deleteAttachmentSchema,
  PlatformError,
  listAttachmentsSchema,
  requestUploadSchema,
  createTagSchema,
  hasExactlyOneSubject,
  listActivitiesSchema,
  subjectOf,
  tagSubjectSchema,
  type SubjectRef,
} from "../model";
import { confirmUpload, enqueueStorageRemoval, requestUpload, storageUsage } from "./attachments";

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
    throw new InvalidError(
      PlatformError.SUBJECT_AMBIGUOUS,
      "Attach this to exactly one person, company or property",
      "personId"
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
    throw new NotFoundError(PlatformError.SUBJECT_NOT_FOUND, "That subject was not found");
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
        kind: input.kind,
        // A reservation nobody uploaded against is not a file yet, and a
        // revoked one is a record that a file existed.
        status: AttachmentStatus.READY,
        revokedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
  }),

  /**
   * Phase one. Reserves the row, the key and the quota, and answers with either
   * a ticket for the provider or our own URL to post at.
   *
   * **The key is generated in the service**, never accepted from a caller —
   * that is the only way "random, not derived from an id" can be guaranteed.
   */
  requestUpload: protectedProcedure.input(requestUploadSchema).mutation(async ({ ctx, input }) => {
    const { user, role } = await requireOrgMember(ctx, input.organizationId);
    if (!canUploadAttachments(role)) {
      throw new ForbiddenError(PlatformError.ATTACHMENT_CREATE_FORBIDDEN, "You cannot add files");
    }
    await assertSubjectInOrg(input.organizationId, input);

    return requestUpload({ ...input, uploadedById: user.id });
  }),

  /** Phase two. Believes storage, not the caller. */
  confirmUpload: protectedProcedure.input(confirmUploadSchema).mutation(async ({ ctx, input }) => {
    await requireOrgMember(ctx, input.organizationId);
    return confirmUpload(input);
  }),

  /**
   * The row goes now; the bytes go when the worker runs. Both are decided in
   * one transaction, which is the whole reason the outbox exists.
   */
  deleteAttachment: protectedProcedure
    .input(deleteAttachmentSchema)
    .mutation(async ({ ctx, input }) => {
      const { role } = await requireOrgMember(ctx, input.organizationId);
      // Not the same right as uploading: this takes the bytes with it, and an
      // identity document deleted by mistake is not recoverable.
      if (!canDeleteAttachments(role)) {
        throw new ForbiddenError(
          PlatformError.ATTACHMENT_DELETE_FORBIDDEN,
          "Only managers can delete files"
        );
      }

      const attachment = await ctx.db.attachment.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
        select: { id: true, storageKey: true, provider: true, providerId: true },
      });
      if (!attachment) {
        throw new NotFoundError(PlatformError.ATTACHMENT_NOT_FOUND, "Attachment not found");
      }

      await ctx.db.$transaction(async (tx) => {
        await enqueueStorageRemoval(tx, [attachment]);
        await tx.attachment.delete({ where: { id: attachment.id } });
      });

      return { id: attachment.id };
    }),

  /** What this organization is holding, and what is left. */
  storageUsage: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireOrgMember(ctx, input.organizationId);
      return storageUsage(ctx.db, input.organizationId);
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
      throw new ConflictError(PlatformError.TAG_NAME_TAKEN, "That tag already exists", "name");
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
      throw new NotFoundError(PlatformError.TAG_NOT_FOUND, "Tag not found");
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
