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

/**
 * A tag's name, as it is compared.
 *
 * `@@unique([organizationId, name])` compares exactly, so " VIP " and "VIP"
 * would be two tags that look identical in a list and match different people —
 * and the hotel's own vocabulary is exactly where that costs something. Trimmed
 * and with runs of whitespace collapsed, once, where both the write and the
 * duplicate check can read it.
 *
 * Case is **kept**: "VIP" and VIP are the same word, but a hotel that writes
 * "Allergic to feathers" did not mean "allergic to feathers".
 */
export function normaliseTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export const createTagSchema = z.object({
  organizationId: z.number(),
  name: z
    .string()
    .min(1, "name_required")
    .max(48)
    .transform(normaliseTagName)
    .refine((name) => name.length > 0, "name_required"),
  colour: z.string().max(16).optional(),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;

export const tagSubjectSchema = subjectInputSchema.extend({
  organizationId: z.number(),
  tagId: z.number(),
});

export type TagSubjectInput = z.infer<typeof tagSubjectSchema>;

export const listSubjectTagsSchema = subjectInputSchema.extend({
  organizationId: z.number(),
});

export type ListSubjectTagsInput = z.infer<typeof listSubjectTagsSchema>;

export const ATTACHMENT_KINDS = ["FILE", "CONSENT", "IDENTITY_DOCUMENT", "CONTRACT"] as const;

export const listAttachmentsSchema = subjectInputSchema.extend({
  organizationId: z.number(),
  // Optional, so a screen can show every file on a subject — but a panel that
  // manages one kind passes it, or mounting two panels on one person shows the
  // same list twice.
  kind: z.enum(ATTACHMENT_KINDS).optional(),
});

export type ListAttachmentsInput = z.infer<typeof listAttachmentsSchema>;
