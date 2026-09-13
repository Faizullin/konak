import { z } from "zod";
import { issueSeveritySchema, issueStatusSchema } from "./issue";
import { taskStatusSchema, taskTypeSchema } from "./task";

/** Date-only, like a stay date: a task belongs to a working day, not an instant. */
export const workDaySchema = z.coerce.date();

export const boardInputSchema = z.object({
  propertyId: z.number(),
  /** Absent means the property's own today, which the server knows and a phone does not. */
  day: workDaySchema.optional(),
});

export type BoardInput = z.infer<typeof boardInputSchema>;

export const createTaskSchema = z.object({
  propertyId: z.number(),
  roomId: z.number(),
  type: taskTypeSchema.default("DEPARTURE_CLEAN"),
  day: workDaySchema.optional(),
  notes: z.string().max(1000).optional(),
  /**
   * Written on a phone that may have been in a stairwell with no signal.
   * Re-sending the same id is the same task, not a second one.
   */
  clientEventId: z.string().min(8).max(128).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const assignTaskSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
  /** `null` puts it back in the pool, which is its own decision. */
  assignedMemberId: z.number().nullable(),
});

export type AssignTaskInput = z.infer<typeof assignTaskSchema>;

export const advanceTaskSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
  status: taskStatusSchema,
  notes: z.string().max(1000).optional(),
});

export type AdvanceTaskInput = z.infer<typeof advanceTaskSchema>;

export const reportIssueSchema = z.object({
  propertyId: z.number(),
  roomId: z.number().optional(),
  title: z.string().min(1, "name_required").max(200),
  description: z.string().max(2000).optional(),
  severity: issueSeveritySchema.default("MEDIUM"),
});

export type ReportIssueInput = z.infer<typeof reportIssueSchema>;

/** The dialog's half: the property and the room come from the screen. */
export const reportIssueFormSchema = reportIssueSchema
  .omit({ propertyId: true, roomId: true, severity: true })
  .extend({ severity: issueSeveritySchema });

export type ReportIssueFormInput = z.infer<typeof reportIssueFormSchema>;

export const resolveIssueSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
  status: issueStatusSchema,
  resolutionNotes: z.string().max(2000).optional(),
});

export type ResolveIssueInput = z.infer<typeof resolveIssueSchema>;
