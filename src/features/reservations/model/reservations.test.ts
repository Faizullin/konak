import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addedNights,
  appearsOnGrid,
  assignLanes,
  DAY_ROLE_LABELS,
  DayRole,
  dayRoleOf,
  availableRooms,
  canTransition,
  GRID_MAX_NIGHTS,
  gridWindowOf,
  isTerminal,
  laneCount,
  monthWindowOf,
  isValidStayRange,
  nextStatuses,
  nightsBetween,
  nightsOf,
  occupiesInventory,
  refuseStatusChange,
  refuseStayMove,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_VALUES,
  ReservationStatus,
  shiftMonths,
  spanInWindow,
  staysOverlap,
  todayAt,
  toStayDate,
} from "./index";

const d = (day: number) => new Date(Date.UTC(2026, 8, day));
const stay = (from: number, to: number) => ({ checkIn: d(from), checkOut: d(to) });
const inRoom = (from: number, to: number, roomId: number | null = 1) => ({
  ...stay(from, to),
  roomId,
});

/**
 * The rules the database cannot hold. SQLite has no exclusion constraint and no
 * CHECK, so overlap and the status machine are enforced here — which is also
 * the only place they can be tested without a database.
 */

test("a stay is half-open, so nights are a subtraction", () => {
  assert.equal(nightsBetween(d(14), d(16)), 2);
  assert.equal(nightsBetween(d(14), d(15)), 1);
  assert.equal(nightsOf(stay(14, 16)).length, 2);
  // The departure day is not a night.
  assert.deepEqual(
    nightsOf(stay(14, 16)).map((n) => n.getUTCDate()),
    [14, 15]
  );
});

test("same-day turnover is not an overlap", () => {
  // One guest leaves on the 16th, the next arrives on the 16th. This is the
  // most ordinary thing a hotel does; an inclusive comparison would refuse it.
  assert.equal(staysOverlap(stay(14, 16), stay(16, 18)), false);
  assert.equal(staysOverlap(stay(16, 18), stay(14, 16)), false);
});

test("every real overlap is caught", () => {
  assert.equal(staysOverlap(stay(14, 16), stay(15, 17)), true, "partial");
  assert.equal(staysOverlap(stay(14, 20), stay(15, 16)), true, "contained");
  assert.equal(staysOverlap(stay(15, 16), stay(14, 20)), true, "containing");
  assert.equal(staysOverlap(stay(14, 16), stay(14, 16)), true, "identical");
  assert.equal(staysOverlap(stay(14, 16), stay(17, 19)), false, "disjoint");
});

test("overlap ignores the time of day", () => {
  // A stay stored with a stray time component must not read as a different day.
  const noon = { checkIn: new Date(Date.UTC(2026, 8, 16, 12)), checkOut: d(18) };
  assert.equal(staysOverlap(stay(14, 16), noon), false);
  assert.equal(toStayDate(new Date(Date.UTC(2026, 8, 16, 23, 59))).getUTCDate(), 16);
});

test("a zero-night stay is a mistake, not a day rate", () => {
  assert.equal(isValidStayRange(stay(14, 16)), true);
  assert.equal(isValidStayRange(stay(14, 14)), false);
  assert.equal(isValidStayRange(stay(16, 14)), false);
});

test("a stay moves forward or it ends", () => {
  assert.equal(canTransition(ReservationStatus.ENQUIRY, ReservationStatus.CONFIRMED), true);
  assert.equal(canTransition(ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN), true);
  assert.equal(canTransition(ReservationStatus.CHECKED_IN, ReservationStatus.CHECKED_OUT), true);

  // Nothing returns to an earlier state: the side effects are not undone by
  // flipping a column back.
  assert.equal(canTransition(ReservationStatus.CHECKED_IN, ReservationStatus.CONFIRMED), false);
  assert.equal(canTransition(ReservationStatus.CHECKED_OUT, ReservationStatus.CHECKED_IN), false);
  assert.equal(canTransition(ReservationStatus.CANCELLED, ReservationStatus.CONFIRMED), false);
});

test("a room cannot be checked out twice", () => {
  // The bug a free-form status column allows.
  assert.equal(canTransition(ReservationStatus.CHECKED_OUT, ReservationStatus.CHECKED_OUT), false);
  assert.equal(isTerminal(ReservationStatus.CHECKED_OUT), true);
  assert.equal(isTerminal(ReservationStatus.CANCELLED), true);
  assert.equal(isTerminal(ReservationStatus.NO_SHOW), true);
  assert.equal(isTerminal(ReservationStatus.CONFIRMED), false);
});

test("a no-show is only reachable from a confirmed booking", () => {
  assert.equal(canTransition(ReservationStatus.CONFIRMED, ReservationStatus.NO_SHOW), true);
  assert.equal(canTransition(ReservationStatus.ENQUIRY, ReservationStatus.NO_SHOW), false);
  assert.equal(canTransition(ReservationStatus.CHECKED_IN, ReservationStatus.NO_SHOW), false);
});

test("a guest checks into a room, not into a room type", () => {
  const unassigned = refuseStatusChange({
    from: ReservationStatus.CONFIRMED,
    to: ReservationStatus.CHECKED_IN,
    stays: [inRoom(10, 12, null)],
    today: d(10),
  });
  assert.match(unassigned ?? "", /assign a room/i);

  assert.equal(
    refuseStatusChange({
      from: ReservationStatus.CONFIRMED,
      to: ReservationStatus.CHECKED_IN,
      stays: [inRoom(10, 12)],
      today: d(10),
    }),
    null
  );

  // One room short is still short: a two-room booking arrives as one guest.
  assert.match(
    refuseStatusChange({
      from: ReservationStatus.CONFIRMED,
      to: ReservationStatus.CHECKED_IN,
      stays: [inRoom(10, 12), inRoom(10, 12, null)],
      today: d(10),
    }) ?? "",
    /assign a room/i
  );
});

test("a booking that has not arrived is wrong dates, not an early arrival", () => {
  const early = { from: ReservationStatus.CONFIRMED, stays: [inRoom(12, 14)], today: d(10) };
  assert.match(
    refuseStatusChange({ ...early, to: ReservationStatus.CHECKED_IN }) ?? "",
    /arrives on/
  );
  // Nor can it fail to turn up before the day it was due.
  assert.match(refuseStatusChange({ ...early, to: ReservationStatus.NO_SHOW }) ?? "", /arrives on/);

  // Arriving late is ordinary, and so is recording a no-show afterwards.
  assert.equal(
    refuseStatusChange({
      from: ReservationStatus.CONFIRMED,
      to: ReservationStatus.CHECKED_IN,
      stays: [inRoom(10, 14)],
      today: d(12),
    }),
    null
  );
  assert.equal(
    refuseStatusChange({
      from: ReservationStatus.CONFIRMED,
      to: ReservationStatus.NO_SHOW,
      stays: [inRoom(10, 12)],
      today: d(14),
    }),
    null
  );

  // But there is no night left to check into once the last one has gone.
  assert.match(
    refuseStatusChange({
      from: ReservationStatus.CONFIRMED,
      to: ReservationStatus.CHECKED_IN,
      stays: [inRoom(8, 10)],
      today: d(10),
    }) ?? "",
    /last night has passed/
  );
});

test("the machine's refusal is the sentence the desk reads", () => {
  assert.equal(
    refuseStatusChange({
      from: ReservationStatus.CONFIRMED,
      to: ReservationStatus.CHECKED_OUT,
      stays: [inRoom(10, 12)],
      today: d(10),
    }),
    "A confirmed reservation cannot become checked out"
  );

  // Checking out is recording what happened, so leaving early is not refused.
  assert.equal(
    refuseStatusChange({
      from: ReservationStatus.CHECKED_IN,
      to: ReservationStatus.CHECKED_OUT,
      stays: [inRoom(10, 14)],
      today: d(11),
    }),
    null
  );
});

test("today is the property's day, not the server's", () => {
  // 22:30 UTC on the 9th is already the 10th in Auckland and still the 9th in
  // Los Angeles — the difference decides whether an arrival is early.
  const evening = new Date("2026-09-09T22:30:00Z");
  assert.deepEqual(todayAt("Pacific/Auckland", evening), new Date(Date.UTC(2026, 8, 10)));
  assert.deepEqual(todayAt("America/Los_Angeles", evening), new Date(Date.UTC(2026, 8, 9)));
  assert.deepEqual(todayAt("UTC", evening), new Date(Date.UTC(2026, 8, 9)));

  // A typo in one property's column must not take the front desk down.
  assert.deepEqual(todayAt("Mars/Olympus", evening), new Date(Date.UTC(2026, 8, 9)));
});

test("an unrecognised status is denied, not thrown at", () => {
  assert.equal(canTransition("PENCILLED_IN", ReservationStatus.CONFIRMED), false);
  assert.equal(canTransition("", ""), false);
  assert.deepEqual(nextStatuses("NONSENSE"), []);
  assert.equal(isTerminal("NONSENSE"), false);
});

test("every status is in the transition table", () => {
  // A value added to the enum without a row would silently become terminal.
  for (const status of RESERVATION_STATUS_VALUES) {
    assert.equal(typeof isTerminal(status), "boolean", `${status} has no transitions`);
  }
});

test("what counts against availability decides what can be sold", () => {
  // CHECKED_OUT still occupies: the guest did sleep there, and a past night
  // must not read as free.
  assert.equal(occupiesInventory(ReservationStatus.CONFIRMED), true);
  assert.equal(occupiesInventory(ReservationStatus.CHECKED_IN), true);
  assert.equal(occupiesInventory(ReservationStatus.CHECKED_OUT), true);

  // An enquiry is a quote; a real hold is `InventoryHold`, which expires.
  assert.equal(occupiesInventory(ReservationStatus.ENQUIRY), false);
  assert.equal(occupiesInventory(ReservationStatus.CANCELLED), false);
  assert.equal(occupiesInventory(ReservationStatus.NO_SHOW), false);
});

test("availability never goes negative", () => {
  assert.equal(availableRooms(10, 1, 4, 2), 3);
  // Overbooked by hand or by a channel: the answer is zero, not a negative that
  // some later subtraction turns back into a sale.
  assert.equal(availableRooms(2, 0, 3, 0), 0);
});

/**
 * The grid's geometry. A span drawn one column off is a room shown as free on a
 * night it is sold, so the arithmetic is tested here rather than by looking at
 * the screen.
 */

const window31 = { from: d(1), nights: 31 };

test("a window is at least one night and at most the cap", () => {
  assert.deepEqual(gridWindowOf(d(1), d(32)), { from: d(1), nights: 31 });
  assert.equal(gridWindowOf(d(1), d(1)), null);
  // The window bounds the query; a year of every room is not a screen.
  assert.equal(gridWindowOf(d(1), new Date(Date.UTC(2026, 8, 1 + GRID_MAX_NIGHTS + 1))), null);
  assert.deepEqual(gridWindowOf(new Date(Date.UTC(2026, 8, 1, 22, 30)), d(3)), {
    from: d(1),
    nights: 2,
  });
});

test("a stay is drawn from its arrival column for as many nights as it holds", () => {
  assert.deepEqual(spanInWindow(stay(4, 7), window31), {
    offset: 3,
    nights: 3,
    continuesBefore: false,
    continuesAfter: false,
  });
});

test("a stay running past either edge is clipped, and says so", () => {
  // The arrival is off-screen: the left edge is the window's, not the stay's,
  // and it must not offer a resize handle.
  assert.deepEqual(
    spanInWindow({ checkIn: new Date(Date.UTC(2026, 7, 28)), checkOut: d(3) }, window31),
    {
      offset: 0,
      nights: 2,
      continuesBefore: true,
      continuesAfter: false,
    }
  );

  assert.deepEqual(
    spanInWindow({ checkIn: d(30), checkOut: new Date(Date.UTC(2026, 9, 4)) }, window31),
    {
      offset: 29,
      nights: 2,
      continuesBefore: false,
      continuesAfter: true,
    }
  );
});

test("a stay that only touches the window by its departure is not drawn", () => {
  // Half-open: departing on the 1st occupies no night of a window starting there.
  assert.equal(
    spanInWindow({ checkIn: new Date(Date.UTC(2026, 7, 30)), checkOut: d(1) }, window31),
    null
  );
  assert.equal(spanInWindow(stay(1, 2), { from: d(2), nights: 5 }), null);
});

test("back-to-back stays share a lane; overlapping ones stack", () => {
  const spans = [stay(1, 4), stay(4, 6), stay(2, 3)].map((s) => spanInWindow(s, window31)!);
  const laned = assignLanes(spans);

  // Same-day turnover is the most ordinary thing a hotel does, and it draws on
  // one line.
  assert.deepEqual(
    laned.map((span) => [span.offset, span.lane]),
    [
      [0, 0],
      [1, 1],
      [3, 0],
    ]
  );
  assert.equal(laneCount(laned), 2);
});

test("an empty row has no height", () => {
  assert.equal(laneCount(assignLanes([])), 0);
});

test("the grid draws everything a cancellation did not release", () => {
  // An enquiry holds no inventory but is still on the desk's mind; a cancelled
  // stay drawn on the grid would say a free room is taken.
  assert.equal(appearsOnGrid(ReservationStatus.ENQUIRY), true);
  assert.equal(appearsOnGrid(ReservationStatus.CHECKED_OUT), true);
  assert.equal(appearsOnGrid(ReservationStatus.CANCELLED), false);
  assert.equal(appearsOnGrid(ReservationStatus.NO_SHOW), false);
});

test("a month is a window, and moving by one crosses the year", () => {
  assert.deepEqual(monthWindowOf(new Date(Date.UTC(2026, 8, 17))), {
    from: new Date(Date.UTC(2026, 8, 1)),
    to: new Date(Date.UTC(2026, 9, 1)),
  });
  assert.deepEqual(shiftMonths(new Date(Date.UTC(2026, 11, 5)), 1), new Date(Date.UTC(2027, 0, 1)));
  assert.deepEqual(
    shiftMonths(new Date(Date.UTC(2026, 0, 5)), -1),
    new Date(Date.UTC(2025, 11, 1))
  );
});

test("every status has a label, so the grid never draws a raw column value", () => {
  for (const status of RESERVATION_STATUS_VALUES) {
    assert.equal(typeof RESERVATION_STATUS_LABELS[status], "string", status);
  }
});

test("a day sorts a stay into exactly one of the desk's three lists", () => {
  const stay = {
    checkIn: new Date(Date.UTC(2027, 2, 3)),
    checkOut: new Date(Date.UTC(2027, 2, 6)),
  };
  const on = (n: number) => dayRoleOf(stay, new Date(Date.UTC(2027, 2, n)));

  assert.equal(on(2), null);
  assert.equal(on(3), DayRole.ARRIVAL);
  assert.equal(on(4), DayRole.IN_HOUSE);
  assert.equal(on(5), DayRole.IN_HOUSE);
  // The departure day is not a night, and is still the morning's work.
  assert.equal(on(6), DayRole.DEPARTURE);
  assert.equal(on(7), null);
});

test("a one-night stay arrives and departs, and is in house on neither day", () => {
  const stay = {
    checkIn: new Date(Date.UTC(2027, 2, 3)),
    checkOut: new Date(Date.UTC(2027, 2, 4)),
  };

  assert.equal(dayRoleOf(stay, new Date(Date.UTC(2027, 2, 3))), DayRole.ARRIVAL);
  assert.equal(dayRoleOf(stay, new Date(Date.UTC(2027, 2, 4))), DayRole.DEPARTURE);
});

test("the day roles read against a time of day, not only a midnight", () => {
  const stay = {
    checkIn: new Date(Date.UTC(2027, 2, 3)),
    checkOut: new Date(Date.UTC(2027, 2, 6)),
  };
  // The desk asks with whatever `todayAt` produced; a stray time must not
  // move a booking out of its list.
  assert.equal(dayRoleOf(stay, new Date(Date.UTC(2027, 2, 4, 23, 59))), DayRole.IN_HOUSE);
});

test("every day role has a label, so a list never draws a raw value", () => {
  for (const role of Object.values(DayRole)) {
    assert.equal(typeof DAY_ROLE_LABELS[role], "string", role);
  }
});

const march = (n: number) => new Date(Date.UTC(2027, 2, n));

test("a stay must still be a stay after it moves", () => {
  const move = {
    status: ReservationStatus.CONFIRMED,
    from: { checkIn: march(10), checkOut: march(12) },
    to: { checkIn: march(10), checkOut: march(10) },
    today: march(1),
  };

  assert.equal(refuseStayMove(move), "A stay is at least one night");
});

test("a booking that has ended does not move", () => {
  for (const status of [
    ReservationStatus.CHECKED_OUT,
    ReservationStatus.CANCELLED,
    ReservationStatus.NO_SHOW,
  ]) {
    const refusal = refuseStayMove({
      status,
      from: { checkIn: march(10), checkOut: march(12) },
      to: { checkIn: march(11), checkOut: march(13) },
      today: march(1),
    });
    assert.match(refusal ?? "", /cannot move/, status);
  }
});

test("an arrived guest arrived when they arrived — only the departure moves", () => {
  const from = { checkIn: march(10), checkOut: march(12) };
  const checkedIn = { status: ReservationStatus.CHECKED_IN, from, today: march(13) };

  // Extending the stay is the ordinary case, and is allowed.
  assert.equal(
    refuseStayMove({ ...checkedIn, to: { checkIn: march(10), checkOut: march(14) } }),
    null
  );

  assert.equal(
    refuseStayMove({ ...checkedIn, to: { checkIn: march(11), checkOut: march(14) } }),
    "The guest has already arrived, so only the departure can move"
  );
  // Their last night would be the 11th, and it is already the 13th.
  assert.equal(
    refuseStayMove({ ...checkedIn, to: { checkIn: march(10), checkOut: march(12) } }),
    "That would end the stay before today"
  );
});

test("a guest may check out today, which is not the past", () => {
  // checkOut is exclusive: leaving on the 11th means the 10th was the last
  // night, and that is an ordinary early departure rather than a refusal.
  assert.equal(
    refuseStayMove({
      status: ReservationStatus.CHECKED_IN,
      from: { checkIn: march(10), checkOut: march(14) },
      to: { checkIn: march(10), checkOut: march(11) },
      today: march(11),
    }),
    null
  );
});

test("a booking that has not arrived cannot be moved into nights that have gone", () => {
  const from = { checkIn: march(10), checkOut: march(12) };

  assert.equal(
    refuseStayMove({
      status: ReservationStatus.CONFIRMED,
      from,
      to: { checkIn: march(3), checkOut: march(5) },
      today: march(5),
    }),
    "A booking cannot be moved into nights that have passed"
  );
  // Onto today itself is allowed — that is a guest arriving now.
  assert.equal(
    refuseStayMove({
      status: ReservationStatus.CONFIRMED,
      from,
      to: { checkIn: march(5), checkOut: march(7) },
      today: march(5),
    }),
    null
  );
});

test("only genuinely new nights are asked about, so a stay never refuses itself", () => {
  const from = { checkIn: march(10), checkOut: march(12) };

  // Extending by one: the 10th and 11th are already held, the 12th is new.
  assert.deepEqual(addedNights(from, { checkIn: march(10), checkOut: march(13) }), [march(12)]);
  // Shortening adds nothing.
  assert.deepEqual(addedNights(from, { checkIn: march(10), checkOut: march(11) }), []);
  // A move that overlaps itself only asks about the part that moved.
  assert.deepEqual(addedNights(from, { checkIn: march(11), checkOut: march(13) }), [march(12)]);
  // A move clear of the original asks about all of it.
  assert.deepEqual(addedNights(from, { checkIn: march(20), checkOut: march(22) }), [
    march(20),
    march(21),
  ]);
});
