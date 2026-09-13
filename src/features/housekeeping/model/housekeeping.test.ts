import assert from "node:assert/strict";
import { test } from "node:test";
import { RoomStatus } from "@/features/properties";
import {
  canAdvanceTask,
  IssueSeverity,
  IssueStatus,
  nextTaskStatuses,
  roomStatusAfterIssue,
  roomStatusForTask,
  takesRoomOutOfOrder,
  TASK_STATUS_VALUES,
  TaskStatus,
  TaskType,
} from "./index";

/**
 * The floor's rules, without a database.
 *
 * What a task does to a room is the interesting half: two tables that can
 * disagree, and the rule that keeps them from it.
 */

test("work moves forward, and only being blocked goes back", () => {
  assert.equal(canAdvanceTask(TaskStatus.PENDING, TaskStatus.IN_PROGRESS), true);
  assert.equal(canAdvanceTask(TaskStatus.IN_PROGRESS, TaskStatus.DONE), true);

  // Blocked means the work could not be done; when the fault is fixed it is
  // still owed, so this is the one state that returns.
  assert.equal(canAdvanceTask(TaskStatus.BLOCKED, TaskStatus.PENDING), true);
  assert.equal(canAdvanceTask(TaskStatus.BLOCKED, TaskStatus.IN_PROGRESS), true);

  // Done told somebody the room was ready. Undoing that is a new task.
  assert.equal(canAdvanceTask(TaskStatus.DONE, TaskStatus.PENDING), false);
  assert.equal(nextTaskStatuses(TaskStatus.DONE).length, 0);

  // A column is a string; an unrecognised one answers false rather than throws.
  assert.equal(canAdvanceTask("SOMETHING", TaskStatus.DONE), false);
});

test("every task status is in the transition table", () => {
  for (const status of TASK_STATUS_VALUES) {
    assert.ok(
      nextTaskStatuses(status).length > 0 || status === TaskStatus.DONE,
      `${status} has no entry`
    );
  }
});

test("starting work makes the room in progress; finishing it makes it clean", () => {
  const room = (roomStatus: string, to: string, type: string = TaskType.DEPARTURE_CLEAN) =>
    roomStatusForTask({ type, to, roomStatus });

  assert.equal(room(RoomStatus.DIRTY, TaskStatus.IN_PROGRESS), RoomStatus.IN_PROGRESS);
  assert.equal(room(RoomStatus.IN_PROGRESS, TaskStatus.DONE), RoomStatus.CLEAN);

  // An inspection that passes is a different claim from a clean one, and a
  // manager who inspected wants the difference to survive.
  assert.equal(room(RoomStatus.CLEAN, TaskStatus.DONE, TaskType.INSPECTION), RoomStatus.INSPECTED);

  // Owing work says nothing about what the room *is*.
  assert.equal(room(RoomStatus.DIRTY, TaskStatus.PENDING), null);
  assert.equal(room(RoomStatus.IN_PROGRESS, TaskStatus.BLOCKED), null);

  // Writing the same value again is not a change.
  assert.equal(room(RoomStatus.CLEAN, TaskStatus.DONE), null);
});

test("a room out of order is not cleaned back into sale", () => {
  // The fault was found by somebody, and finishing a clean is not news about
  // it — the same rule check-out obeys.
  for (const to of TASK_STATUS_VALUES) {
    assert.equal(
      roomStatusForTask({
        type: TaskType.DEPARTURE_CLEAN,
        to,
        roomStatus: RoomStatus.OUT_OF_ORDER,
      }),
      null,
      `${to} moved an out-of-order room`
    );
  }
});

test("only a blocking fault stops a sale", () => {
  assert.equal(takesRoomOutOfOrder(IssueSeverity.BLOCKING), true);
  for (const severity of [IssueSeverity.LOW, IssueSeverity.MEDIUM, IssueSeverity.HIGH]) {
    assert.equal(takesRoomOutOfOrder(severity), false);
  }
});

test("a fixed fault gives the room back dirty, never clean", () => {
  const after = (severity: string, to: string, roomStatus: string) =>
    roomStatusAfterIssue({ severity, to, roomStatus });

  // Reporting it closes the room.
  assert.equal(
    after(IssueSeverity.BLOCKING, IssueStatus.OPEN, RoomStatus.CLEAN),
    RoomStatus.OUT_OF_ORDER
  );

  // Fixed is not cleaned: somebody still has to go in.
  assert.equal(
    after(IssueSeverity.BLOCKING, IssueStatus.RESOLVED, RoomStatus.OUT_OF_ORDER),
    RoomStatus.DIRTY
  );
  assert.equal(
    after(IssueSeverity.BLOCKING, IssueStatus.WONT_FIX, RoomStatus.OUT_OF_ORDER),
    RoomStatus.DIRTY
  );

  // A lesser fault never touched the room, so closing it must not either — or
  // a dripping tap would quietly put a sold room back on sale.
  assert.equal(after(IssueSeverity.LOW, IssueStatus.RESOLVED, RoomStatus.OUT_OF_ORDER), null);

  // Only what this issue closed is reopened by it.
  assert.equal(after(IssueSeverity.BLOCKING, IssueStatus.RESOLVED, RoomStatus.DIRTY), null);
});
