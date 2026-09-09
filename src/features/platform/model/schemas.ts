import { z } from "zod";

/**
 * A subject is one nullable id, exactly one set — the same rule the schema
 * comment states and `hasExactlyOneSubject` enforces.
 */
export const subjectInputSchema = z.object({
  personId: z.number().optional(),
  companyId: z.number().optional(),
  propertyId: z.number().optional(),
});

export const ACTIVITY_TYPES = ["NOTE", "CALL", "EMAIL", "MEETING", "TASK"] as const;

export const activityTypeSchema = z.enum(ACTIVITY_TYPES);

export const createActivitySchema = subjectInputSchema.extend({
  organizationId: z.number(),
  type: activityTypeSchema.default("NOTE"),
  subject: z.string().min(1, "subject_required").max(200),
  body: z.string().max(4000).optional(),
  dueAt: z.coerce.date().optional(),
  /** Set by an offline client so a retry does not duplicate the row. */
  clientEventId: z.string().max(128).optional(),
});

export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export const listActivitiesSchema = subjectInputSchema.extend({
  organizationId: z.number(),
  take: z.number().min(1).max(200).default(50),
});

export type ListActivitiesInput = z.infer<typeof listActivitiesSchema>;

export const createTagSchema = z.object({
  organizationId: z.number(),
  name: z.string().min(1, "name_required").max(48),
  colour: z.string().max(16).optional(),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;

export const tagSubjectSchema = subjectInputSchema.extend({
  organizationId: z.number(),
  tagId: z.number(),
});

export type TagSubjectInput = z.infer<typeof tagSubjectSchema>;

export const ATTACHMENT_KINDS = ["FILE", "CONSENT", "IDENTITY_DOCUMENT", "CONTRACT"] as const;

export const createAttachmentSchema = subjectInputSchema.extend({
  organizationId: z.number(),
  kind: z.enum(ATTACHMENT_KINDS).default("FILE"),
  fileName: z.string().min(1, "file_name_required").max(200),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z
    .number()
    .min(0)
    .max(50 * 1024 * 1024)
    .optional(),
});

export type CreateAttachmentInput = z.infer<typeof createAttachmentSchema>;

export const listAttachmentsSchema = subjectInputSchema.extend({
  organizationId: z.number(),
});

export type ListAttachmentsInput = z.infer<typeof listAttachmentsSchema>;
