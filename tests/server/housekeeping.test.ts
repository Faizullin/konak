import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { callerFor, createFixture, prisma, type Fixture } from "./harness";

/**
 * The floor, against a real database.
 *
 * The rules themselves are pure and tested in `model/`; what this proves is
 * that a task and a `Room.status` actually move together — two tables that can
 * disagree, in one transaction.
 */

let fx: Fixture;
let propertyId: number;
let roomId: number;

before(async () => {
  fx = await createFixture();

  const property = await prisma.property.create({
    data: {
      organizationId: fx.org.id,
      name: `Floor ${fx.tag}`,
      slug: `floor-${fx.tag}`,
      currencyCode: "EUR",
      roomTypes: { create: { name: "Single", code: "SGL", maxOccupancy: 1 } },
    },
    include: { roomTypes: true },
  });
  propertyId = property.id;

  const room = await prisma.room.create({
    data: {
      propertyId,
      roomTypeId: property.roomTypes[0]!.id,
      number: `F-${fx.tag}`,
      status: "DIRTY",
    },
  });
  roomId = room.id;
});

after(async () => {
  await prisma.housekeepingTask.deleteMany({ where: { propertyId } });
  await prisma.maintenanceIssue.deleteMany({ where: { propertyId } });
  await prisma.room.deleteMany({ where: { propertyId } });
  await prisma.roomType.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { organizationId: fx.org.id } });
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("the board", () => {
  test("every room appears, whether or not anything is owed on it", async () => {
    // The floor walks the building, not a list of tasks: a clean room with
    // nothing owed is still a room somebody has to know about.
    const board = await callerFor(fx.owner).housekeeping.board({ propertyId });

    assert.equal(board.rooms.length, 1);
    assert.equal(board.rooms[0]?.tasks.length, 0);
    assert.equal(board.rooms[0]?.status, "DIRTY");
  });
});

describe("a task and the room move together", () => {
  test("starting and finishing a clean carries the room with it", async () => {
    const caller = callerFor(fx.owner);

    const task = await caller.housekeeping.createTask({
      propertyId,
      roomId,
      type: "DEPARTURE_CLEAN",
    });

    await caller.housekeeping.advanceTask({ propertyId, id: task.id, status: "IN_PROGRESS" });
    let room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    assert.equal(room.status, "IN_PROGRESS");

    await caller.housekeeping.advanceTask({ propertyId, id: task.id, status: "DONE" });
    room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    assert.equal(room.status, "CLEAN");
  });

  test("a task does not go backwards once it is done", async () => {
    const caller = callerFor(fx.owner);
    const task = await caller.housekeeping.createTask({ propertyId, roomId, type: "STAY_OVER" });

    await caller.housekeeping.advanceTask({ propertyId, id: task.id, status: "DONE" });
    await assert.rejects(
      caller.housekeeping.advanceTask({ propertyId, id: task.id, status: "PENDING" }),
      (e) => /not a move/i.test(e instanceof Error ? e.message : "")
    );
  });

  test("the same task sent twice from a stairwell is one task", async () => {
    const caller = callerFor(fx.owner);
    const clientEventId = `offline-${fx.tag}`;

    const first = await caller.housekeeping.createTask({
      propertyId,
      roomId,
      type: "DEEP_CLEAN",
      clientEventId,
    });
    const second = await caller.housekeeping.createTask({
      propertyId,
      roomId,
      type: "DEEP_CLEAN",
      clientEventId,
    });

    assert.equal(first.id, second.id);
  });
});

describe("who is doing it", () => {
  test("a task is assigned, and put back down again", async () => {
    const caller = callerFor(fx.owner);
    const task = await caller.housekeeping.createTask({ propertyId, roomId, type: "TURNDOWN" });

    // Whatever the room is right now — the claim is that this does not move it,
    // not that it is in any particular state when the test happens to run.
    const before = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });

    const member = await prisma.organizationMember.findFirstOrThrow({
      where: { organizationId: fx.org.id },
      select: { id: true },
    });

    const assigned = await caller.housekeeping.assignTask({
      propertyId,
      id: task.id,
      assignedMemberId: member.id,
    });
    assert.equal(assigned.assignedMemberId, member.id);

    // Putting it back in the pool is its own decision, not an absence.
    const released = await caller.housekeeping.assignTask({
      propertyId,
      id: task.id,
      assignedMemberId: null,
    });
    assert.equal(released.assignedMemberId, null);

    // And none of it said anything about the room: a task can be picked up and
    // put down all morning without the room changing at all.
    const after = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    assert.equal(after.status, before.status);
  });

  test("somebody else's member cannot be given this hotel's work", async () => {
    const caller = callerFor(fx.owner);
    const task = await caller.housekeeping.createTask({ propertyId, roomId, type: "INSPECTION" });

    const other = await createFixture();
    try {
      const theirs = await prisma.organizationMember.findFirstOrThrow({
        where: { organizationId: other.org.id },
        select: { id: true },
      });

      await assert.rejects(
        caller.housekeeping.assignTask({
          propertyId,
          id: task.id,
          assignedMemberId: theirs.id,
        }),
        (e) => /not a member/i.test(e instanceof Error ? e.message : "")
      );
    } finally {
      await other.cleanup();
    }
  });
});

describe("a fault is the floor's one hand on the money", () => {
  test("a blocking fault takes the room out of sale, and fixing it gives it back dirty", async () => {
    const caller = callerFor(fx.owner);
    await prisma.room.update({ where: { id: roomId }, data: { status: "CLEAN" } });

    const issue = await caller.housekeeping.reportIssue({
      propertyId,
      roomId,
      title: "Shower will not drain",
      severity: "BLOCKING",
    });

    let room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    assert.equal(room.status, "OUT_OF_ORDER");

    await caller.housekeeping.resolveIssue({ propertyId, id: issue.id, status: "RESOLVED" });

    // Fixed is not cleaned: somebody still has to go in.
    room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    assert.equal(room.status, "DIRTY");
  });

  test("a lesser fault is work, not a closure", async () => {
    const caller = callerFor(fx.owner);
    await prisma.room.update({ where: { id: roomId }, data: { status: "CLEAN" } });

    await caller.housekeeping.reportIssue({
      propertyId,
      roomId,
      title: "A dripping tap",
      severity: "LOW",
    });

    const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    assert.equal(room.status, "CLEAN");
  });

  test("a clean does not put an out-of-order room back on sale", async () => {
    const caller = callerFor(fx.owner);
    await prisma.room.update({ where: { id: roomId }, data: { status: "OUT_OF_ORDER" } });

    const task = await caller.housekeeping.createTask({
      propertyId,
      roomId,
      type: "DEPARTURE_CLEAN",
    });
    await caller.housekeeping.advanceTask({ propertyId, id: task.id, status: "DONE" });

    const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    assert.equal(room.status, "OUT_OF_ORDER");
  });
});
