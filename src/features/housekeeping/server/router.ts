import "server-only";
import { NotFoundError, refused } from "@/server/errors";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { RoomStatus, compareRoomNumbers } from "@/features/properties";
import { requirePropertyMember } from "@/features/properties/server";
import { todayAt, toStayDate } from "@/features/reservations";
import {
  advanceTaskSchema,
  assignTaskSchema,
  boardInputSchema,
  canAdvanceTask,
  createTaskSchema,
  IssueStatus,
  reportIssueSchema,
  resolveIssueSchema,
  roomStatusAfterIssue,
  roomStatusForTask,
  takesRoomOutOfOrder,
  TaskStatus,
} from "../model";

/**
 * The floor's day: what each room is, what is owed on it, and what is broken.
 *
 * A task and a `Room.status` are two tables that can disagree, so every write
 * that changes one changes the other in the same transaction, and *what* it
 * changes it to is a pure function in `model/` rather than a decision taken
 * here. The interesting cases — an inspection, a room out of order — are tested
 * without a database because of that.
 */

export const housekeepingRouter = createTRPCRouter({
  /**
   * One day's board, in one call.
   *
   * Every room, because the floor walks the building rather than a list of
   * tasks — a clean room with nothing owed is still a room somebody has to know
   * about. The tasks and open faults hang off it.
   */
  board: protectedProcedure.input(boardInputSchema).query(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    const property = await ctx.db.property.findUniqueOrThrow({
      where: { id: input.propertyId },
      select: { timezone: true },
    });
    // The property's day, not the phone's: a cleaner starting at 01:00 is still
    // on yesterday's board in some timezones and tomorrow's in others.
    const day = input.day ? toStayDate(input.day) : todayAt(property.timezone);

    const [rooms, tasks, issues] = await Promise.all([
      ctx.db.room.findMany({
        where: { propertyId: input.propertyId, archivedAt: null },
        select: {
          id: true,
          number: true,
          floor: true,
          status: true,
          roomType: { select: { id: true, name: true } },
        },
      }),
      ctx.db.housekeepingTask.findMany({
        where: { propertyId: input.propertyId, dueDate: day },
        select: {
          id: true,
          roomId: true,
          type: true,
          status: true,
          notes: true,
          startedAt: true,
          completedAt: true,
          assignedMemberId: true,
          assignee: { select: { id: true, user: { select: { name: true } } } },
        },
        orderBy: [{ priority: "desc" }, { id: "asc" }],
      }),
      ctx.db.maintenanceIssue.findMany({
        where: {
          propertyId: input.propertyId,
          status: { in: [IssueStatus.OPEN, IssueStatus.IN_PROGRESS] },
        },
        select: { id: true, roomId: true, title: true, severity: true, status: true },
      }),
    ]);

    const byRoom = <T extends { roomId: number | null }>(rows: T[]) => {
      const map = new Map<number, T[]>();
      for (const row of rows) {
        if (row.roomId === null) continue;
        const list = map.get(row.roomId);
        if (list) list.push(row);
        else map.set(row.roomId, [row]);
      }
      return map;
    };

    const tasksByRoom = byRoom(tasks);
    const issuesByRoom = byRoom(issues);

    return {
      day,
      rooms: rooms
        .toSorted((a, b) => compareRoomNumbers(a.number, b.number))
        .map((room) => ({
          ...room,
          tasks: tasksByRoom.get(room.id) ?? [],
          issues: issuesByRoom.get(room.id) ?? [],
        })),
    };
  }),

  createTask: protectedProcedure.input(createTaskSchema).mutation(async ({ ctx, input }) => {
    const { property, user } = await requirePropertyMember(ctx, input.propertyId);

    // Together, not one after the other: neither answer decides whether to ask
    // for the other, and three sequential round trips for one button is the
    // kind of thing the end-of-phase pass exists to catch.
    const [room, hotel] = await Promise.all([
      ctx.db.room.findFirst({
        where: { id: input.roomId, propertyId: input.propertyId },
        select: { id: true },
      }),
      ctx.db.property.findUniqueOrThrow({
        where: { id: property.id },
        select: { timezone: true },
      }),
    ]);
    if (!room) {
      throw new NotFoundError("room.not_found", "Room not found");
    }

    const dueDate = input.day ? toStayDate(input.day) : todayAt(hotel.timezone);

    // The same work sent twice from a stairwell is one task. `clientEventId` is
    // unique, so this is the write itself refusing rather than a check racing it.
    if (input.clientEventId) {
      const existing = await ctx.db.housekeepingTask.findUnique({
        where: { clientEventId: input.clientEventId },
      });
      if (existing) return existing;
    }

    return ctx.db.housekeepingTask.create({
      data: {
        propertyId: input.propertyId,
        roomId: input.roomId,
        type: input.type,
        dueDate,
        notes: input.notes,
        clientEventId: input.clientEventId,
        createdById: user.id,
      },
    });
  }),

  /**
   * Who is doing it, or nobody.
   *
   * To an `OrganizationMember` rather than a `User`, which the schema chose for
   * a reason worth repeating: membership of this property's organization is
   * what makes somebody assignable, so revoking it unassigns them rather than
   * leaving a name on work nobody can do.
   *
   * Assignment says nothing about the room. A task can be picked up and put
   * down all morning without the room changing at all.
   */
  assignTask: protectedProcedure.input(assignTaskSchema).mutation(async ({ ctx, input }) => {
    const { property } = await requirePropertyMember(ctx, input.propertyId);

    const [task, member] = await Promise.all([
      ctx.db.housekeepingTask.findFirst({
        where: { id: input.id, propertyId: input.propertyId },
        select: { id: true },
      }),
      input.assignedMemberId === null
        ? Promise.resolve(null)
        : ctx.db.organizationMember.findFirst({
            // Scoped to the property's own organization: somebody else's
            // member is not a person who can clean this hotel's rooms.
            where: { id: input.assignedMemberId, organizationId: property.organizationId },
            select: { id: true },
          }),
    ]);

    if (!task) {
      throw new NotFoundError("task.not_found", "Task not found");
    }
    if (input.assignedMemberId !== null && !member) {
      throw new NotFoundError(
        "member.not_found",
        "That person is not a member of this organization"
      );
    }

    return ctx.db.housekeepingTask.update({
      where: { id: task.id },
      data: { assignedMemberId: input.assignedMemberId },
    });
  }),

  /**
   * Move a task, and the room with it.
   *
   * One transaction, because a board that says "done" beside a room still
   * marked dirty is two answers to one question.
   */
  advanceTask: protectedProcedure.input(advanceTaskSchema).mutation(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    const task = await ctx.db.housekeepingTask.findFirst({
      where: { id: input.id, propertyId: input.propertyId },
      select: {
        id: true,
        type: true,
        status: true,
        roomId: true,
        room: { select: { id: true, status: true } },
      },
    });
    if (!task) {
      throw new NotFoundError("task.not_found", "Task not found");
    }

    if (!canAdvanceTask(task.status, input.status)) {
      throw refused({
        code: "task.transition_illegal",
        values: { from: task.status, to: input.status },
        message: "That is not a move this task can make",
      });
    }

    const roomStatus = roomStatusForTask({
      type: task.type,
      to: input.status,
      roomStatus: task.room.status,
    });

    return ctx.db.$transaction(async (tx) => {
      if (roomStatus) {
        await tx.room.updateMany({ where: { id: task.roomId }, data: { status: roomStatus } });
      }

      return tx.housekeepingTask.update({
        where: { id: task.id },
        data: {
          status: input.status,
          notes: input.notes ?? undefined,
          startedAt: input.status === TaskStatus.IN_PROGRESS ? new Date() : undefined,
          completedAt: input.status === TaskStatus.DONE ? new Date() : undefined,
        },
      });
    });
  }),

  /**
   * A fault, reported from the floor.
   *
   * The one thing the floor does that costs the hotel a sale: `BLOCKING` takes
   * the room out of order, and out of order is what removes it from what can be
   * sold. Intended, and the reason severity is a choice rather than a label.
   */
  reportIssue: protectedProcedure.input(reportIssueSchema).mutation(async ({ ctx, input }) => {
    const { member } = await requirePropertyMember(ctx, input.propertyId);

    const room = input.roomId
      ? await ctx.db.room.findFirst({
          where: { id: input.roomId, propertyId: input.propertyId },
          select: { id: true, status: true },
        })
      : null;
    if (input.roomId && !room) {
      throw new NotFoundError("room.not_found", "Room not found");
    }

    return ctx.db.$transaction(async (tx) => {
      if (room && takesRoomOutOfOrder(input.severity)) {
        await tx.room.updateMany({
          where: { id: room.id },
          data: { status: RoomStatus.OUT_OF_ORDER },
        });
      }

      return tx.maintenanceIssue.create({
        data: {
          propertyId: input.propertyId,
          roomId: input.roomId,
          title: input.title,
          description: input.description,
          severity: input.severity,
          reportedByMemberId: member.id,
        },
      });
    });
  }),

  resolveIssue: protectedProcedure.input(resolveIssueSchema).mutation(async ({ ctx, input }) => {
    await requirePropertyMember(ctx, input.propertyId);

    const issue = await ctx.db.maintenanceIssue.findFirst({
      where: { id: input.id, propertyId: input.propertyId },
      select: {
        id: true,
        severity: true,
        roomId: true,
        room: { select: { id: true, status: true } },
      },
    });
    if (!issue) {
      throw new NotFoundError("issue.not_found", "Issue not found");
    }

    const roomStatus = issue.room
      ? roomStatusAfterIssue({
          severity: issue.severity,
          to: input.status,
          roomStatus: issue.room.status,
        })
      : null;

    return ctx.db.$transaction(async (tx) => {
      if (roomStatus && issue.roomId) {
        await tx.room.updateMany({ where: { id: issue.roomId }, data: { status: roomStatus } });
      }

      return tx.maintenanceIssue.update({
        where: { id: issue.id },
        data: {
          status: input.status,
          resolutionNotes: input.resolutionNotes,
          resolvedAt:
            input.status === IssueStatus.RESOLVED || input.status === IssueStatus.WONT_FIX
              ? new Date()
              : null,
        },
      });
    });
  }),
});
