import { z } from "zod";
import { RoomStatus } from "@/features/properties";

/**
 * A broken thing, reported from the floor.
 *
 * This is the one screen the floor has that touches the money: `BLOCKING` takes
 * a room out of order, and out of order is what removes it from sale. That is
 * the intended behaviour and the reason severity is a decision rather than a
 * label — a cleaner choosing it is choosing whether the hotel can sell tonight.
 */

export const IssueSeverity = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  /** The room cannot be sold until this is fixed. */
  BLOCKING: "BLOCKING",
} as const;

export type IssueSeverity = (typeof IssueSeverity)[keyof typeof IssueSeverity];

export const ISSUE_SEVERITY_VALUES = Object.values(IssueSeverity);

export const issueSeveritySchema = z.enum(ISSUE_SEVERITY_VALUES);

export const IssueStatus = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  RESOLVED: "RESOLVED",
  WONT_FIX: "WONT_FIX",
} as const;

export type IssueStatus = (typeof IssueStatus)[keyof typeof IssueStatus];

export const ISSUE_STATUS_VALUES = Object.values(IssueStatus);

export const issueStatusSchema = z.enum(ISSUE_STATUS_VALUES);

/** Only the worst one stops a sale. The rest are work, not a closure. */
export function takesRoomOutOfOrder(severity: string): boolean {
  return severity === IssueSeverity.BLOCKING;
}

/**
 * What closing an issue leaves the room as, or `null` to leave it alone.
 *
 * A room that was taken out of order comes back **dirty**, never clean: the
 * fault is fixed, and somebody still has to go in. Only a blocking issue put it
 * there, so only a blocking issue takes it back.
 */
export function roomStatusAfterIssue(args: {
  severity: string;
  to: string;
  roomStatus: string;
}): RoomStatus | null {
  if (!takesRoomOutOfOrder(args.severity)) return null;

  if (args.to === IssueStatus.OPEN || args.to === IssueStatus.IN_PROGRESS) {
    return args.roomStatus === RoomStatus.OUT_OF_ORDER ? null : RoomStatus.OUT_OF_ORDER;
  }

  // Resolved, or decided against. Either way the room is sellable again and
  // nobody has cleaned it.
  if (args.roomStatus !== RoomStatus.OUT_OF_ORDER) return null;
  return RoomStatus.DIRTY;
}
