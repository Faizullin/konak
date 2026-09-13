import { z } from "zod";
import { RoomStatus } from "@/features/properties";

/**
 * The floor's work, as a machine.
 *
 * `Room.status` is what a room *is*; a task is the work that changes it. They
 * are separate on purpose — a room can be dirty with nobody assigned, and a
 * status can be set by someone who never held a task — so what a task does to a
 * room is stated here rather than assumed at the call site.
 */

export const TaskType = {
  /** After a guest leaves. The one check-out creates. */
  DEPARTURE_CLEAN: "DEPARTURE_CLEAN",
  /** A guest still in the room: towels and beds, not a turnover. */
  STAY_OVER: "STAY_OVER",
  DEEP_CLEAN: "DEEP_CLEAN",
  INSPECTION: "INSPECTION",
  TURNDOWN: "TURNDOWN",
} as const;

export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const TASK_TYPE_VALUES = Object.values(TaskType);

export const taskTypeSchema = z.enum(TASK_TYPE_VALUES);

export const TaskStatus = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
  /** Something in the room stops the work — usually a fault. */
  BLOCKED: "BLOCKED",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TASK_STATUS_VALUES = Object.values(TaskStatus);

export const taskStatusSchema = z.enum(TASK_STATUS_VALUES);

/**
 * What may follow what.
 *
 * `BLOCKED` is the one state that goes back, and deliberately: it means the
 * work could not be done, and when the fault is fixed the work is still owed.
 * Every other move is forward, for the same reason a reservation's are — `DONE`
 * told somebody the room was ready.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  [TaskStatus.PENDING]: [TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.BLOCKED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.DONE, TaskStatus.BLOCKED],
  [TaskStatus.BLOCKED]: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
  [TaskStatus.DONE]: [],
};

export function canAdvanceTask(from: string, to: string): boolean {
  const allowed = TRANSITIONS[from as TaskStatus];
  return allowed ? allowed.includes(to as TaskStatus) : false;
}

export function nextTaskStatuses(from: string): readonly TaskStatus[] {
  return TRANSITIONS[from as TaskStatus] ?? [];
}

/**
 * What a task's new state makes of the room, or `null` for no change.
 *
 * An **inspection** that passes leaves the room inspected rather than clean:
 * they are different claims, and a manager who inspects wants the difference to
 * survive. Everything else that finishes leaves it clean.
 *
 * A room **out of order** is never moved by a task. That state was set by
 * somebody who found a fault, and finishing a clean is not news about the
 * fault — the same rule check-out obeys.
 */
export function roomStatusForTask(args: {
  type: string;
  to: string;
  roomStatus: string;
}): RoomStatus | null {
  if (args.roomStatus === RoomStatus.OUT_OF_ORDER) return null;

  if (args.to === TaskStatus.IN_PROGRESS) {
    return args.roomStatus === RoomStatus.IN_PROGRESS ? null : RoomStatus.IN_PROGRESS;
  }

  if (args.to === TaskStatus.DONE) {
    const finished = args.type === TaskType.INSPECTION ? RoomStatus.INSPECTED : RoomStatus.CLEAN;
    return args.roomStatus === finished ? null : finished;
  }

  // Pending and blocked say nothing about the room: the work is owed, and what
  // the room *is* has not changed by owing it.
  return null;
}
