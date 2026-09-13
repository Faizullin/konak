import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { callerFor, createFixture, domainCodeOf, prisma, type Fixture } from "./harness";
import { BillingError } from "@/features/billing";

/**
 * Phase 6's **Done when**, against a real database: a stay produces a bill that
 * balances, is settled and closed, with numbers that never repeat.
 */

let fx: Fixture;
let propertyId: number;
let reservationId: number;

before(async () => {
  fx = await createFixture();

  const property = await prisma.property.create({
    data: {
      organizationId: fx.org.id,
      name: `Bill ${fx.tag}`,
      slug: `bill-${fx.tag}`,
      currencyCode: "EUR",
      roomTypes: { create: { name: "Double", code: "DBL", maxOccupancy: 2 } },
      numberSeries: {
        create: {
          organizationId: fx.org.id,
          kind: "FOLIO",
          prefix: "F-",
          period: "2027",
          counter: 0,
        },
      },
    },
    include: { roomTypes: true },
  });
  propertyId = property.id;

  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      reference: `BILL-${fx.tag}`,
      status: "CHECKED_OUT",
      currencyCode: "EUR",
      stays: {
        create: [
          {
            roomTypeId: property.roomTypes[0]!.id,
            status: "CHECKED_OUT",
            checkIn: new Date(Date.UTC(2027, 2, 1)),
            checkOut: new Date(Date.UTC(2027, 2, 3)),
            currencyCode: "EUR",
          },
        ],
      },
    },
  });
  reservationId = reservation.id;
});

after(async () => {
  await prisma.payment.deleteMany({ where: { propertyId } });
  await prisma.folio.deleteMany({ where: { propertyId } });
  await prisma.reservation.deleteMany({ where: { propertyId } });
  await prisma.roomType.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { organizationId: fx.org.id } });
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("a bill that balances, settles and closes", () => {
  test("a reservation says whether it already has a bill, without opening one", async () => {
    const caller = callerFor(fx.owner);

    // Nothing yet, and asking must not create one — the screen calls this on
    // every render of a booking card.
    assert.equal(await caller.billing.currentFolio({ propertyId, reservationId }), null);

    const folio = await caller.billing.folioForReservation({ propertyId, reservationId });
    const found = await caller.billing.currentFolio({ propertyId, reservationId });
    assert.equal(found?.id, folio.id);
  });

  test("the whole cycle, and the number came from the series", async () => {
    const caller = callerFor(fx.owner);

    const folio = await caller.billing.folioForReservation({ propertyId, reservationId });

    // Opened lazily and once: asking again is the same folio, not a second
    // number burnt on the same stay.
    const again = await caller.billing.folioForReservation({ propertyId, reservationId });
    assert.equal(again.id, folio.id);

    await caller.billing.postLine({
      propertyId,
      folioId: folio.id,
      type: "ROOM",
      description: "Two nights",
      quantity: 2,
      unitPriceMinor: 10_000,
      taxRateBp: 2000,
    });

    // Unbalanced is refused with the amount, not a generic error: the number is
    // what tells the desk how much more to take.
    const short = await caller.billing
      .close({ propertyId, id: folio.id })
      .then(() => null)
      .catch((e) => e);
    assert.equal(domainCodeOf(short), BillingError.FOLIO_UNBALANCED);

    await caller.billing.takePayment({
      propertyId,
      folioId: folio.id,
      method: "CARD",
      amountMinor: 24_000,
    });

    const closed = await caller.billing.close({ propertyId, id: folio.id });
    assert.equal(closed.status, "CLOSED");
    // Frozen, so the bill reads the same for ever.
    assert.equal(closed.closedTotalMinor, 24_000);
    assert.match(closed.number, /^F-/);
  });

  test("a closed folio takes no more charges", async () => {
    const caller = callerFor(fx.owner);
    const folio = await caller.billing.folioForReservation({ propertyId, reservationId });

    const error = await caller.billing
      .postLine({
        propertyId,
        folioId: folio.id,
        type: "EXTRA",
        description: "A late minibar",
        quantity: 1,
        unitPriceMinor: 500,
      })
      .then(() => null)
      .catch((e) => e);

    assert.equal(domainCodeOf(error), BillingError.FOLIO_CLOSED);
  });
});

describe("corrections and refunds", () => {
  let folioId: number;

  before(async () => {
    const caller = callerFor(fx.owner);
    const second = await prisma.reservation.create({
      data: {
        propertyId,
        reference: `BILL2-${fx.tag}`,
        status: "CHECKED_IN",
        currencyCode: "EUR",
      },
    });
    const folio = await caller.billing.folioForReservation({
      propertyId,
      reservationId: second.id,
    });
    folioId = folio.id;
  });

  test("a void is a correction, and the balance moves with it", async () => {
    const caller = callerFor(fx.owner);

    const wrong = await caller.billing.postLine({
      propertyId,
      folioId,
      type: "EXTRA",
      description: "Charged to the wrong room",
      quantity: 1,
      unitPriceMinor: 5_000,
    });

    // Nothing is edited or deleted: a bill somebody has seen is a record.
    await caller.billing.voidLine({ propertyId, id: wrong.id });

    const after = await caller.billing.get({ propertyId, id: folioId });
    assert.equal(after.lines.length, 1);
    assert.ok(after.lines[0]?.voidedAt);

    // And an empty folio balances, so it can close.
    const closed = await caller.billing.close({ propertyId, id: folioId });
    assert.equal(closed.closedTotalMinor, 0);
  });

  test("a refund is a state on the payment, not a second row", async () => {
    const caller = callerFor(fx.owner);
    const third = await prisma.reservation.create({
      data: {
        propertyId,
        reference: `BILL3-${fx.tag}`,
        status: "CHECKED_IN",
        currencyCode: "EUR",
      },
    });
    const folio = await caller.billing.folioForReservation({
      propertyId,
      reservationId: third.id,
    });

    await caller.billing.postLine({
      propertyId,
      folioId: folio.id,
      type: "SERVICE",
      description: "Airport transfer",
      quantity: 1,
      unitPriceMinor: 3_000,
    });
    const payment = await caller.billing.takePayment({
      propertyId,
      folioId: folio.id,
      method: "CASH",
      amountMinor: 3_000,
    });

    await caller.billing.refundPayment({ propertyId, id: payment.id });

    // The money went back, so the folio is owed again — and there is one row
    // that says so rather than two that could disagree.
    const error = await caller.billing
      .close({ propertyId, id: folio.id })
      .then(() => null)
      .catch((e) => e);
    assert.equal(domainCodeOf(error), BillingError.FOLIO_UNBALANCED);
  });

  test("a double-click does not take the money twice", async () => {
    const caller = callerFor(fx.owner);
    const fourth = await prisma.reservation.create({
      data: {
        propertyId,
        reference: `BILL4-${fx.tag}`,
        status: "CHECKED_IN",
        currencyCode: "EUR",
      },
    });
    const folio = await caller.billing.folioForReservation({
      propertyId,
      reservationId: fourth.id,
    });

    const key = `charge-${fx.tag}`;
    const first = await caller.billing.takePayment({
      propertyId,
      folioId: folio.id,
      method: "CARD",
      amountMinor: 1_000,
      idempotencyKey: key,
    });
    const second = await caller.billing.takePayment({
      propertyId,
      folioId: folio.id,
      method: "CARD",
      amountMinor: 1_000,
      idempotencyKey: key,
    });

    assert.equal(first.id, second.id);
    const payments = await prisma.payment.count({ where: { folioId: folio.id } });
    assert.equal(payments, 1);
  });
});

describe("splitting a bill", () => {
  test("the company pays the room and the guest pays the bar, and a line exists once", async () => {
    const caller = callerFor(fx.owner);
    const stay = await prisma.reservation.create({
      data: {
        propertyId,
        reference: `SPLIT-${fx.tag}`,
        status: "CHECKED_IN",
        currencyCode: "EUR",
      },
    });
    const folio = await caller.billing.folioForReservation({
      propertyId,
      reservationId: stay.id,
    });

    const room = await caller.billing.postLine({
      propertyId,
      folioId: folio.id,
      type: "ROOM",
      description: "One night",
      quantity: 1,
      unitPriceMinor: 12_000,
    });
    await caller.billing.postLine({
      propertyId,
      folioId: folio.id,
      type: "EXTRA",
      description: "Bar",
      quantity: 1,
      unitPriceMinor: 2_500,
    });

    const second = await caller.billing.split({
      propertyId,
      id: folio.id,
      lineIds: [room.id],
    });

    // Moved, not copied: a charge exists once, and two folios each holding a
    // version of it is how a hotel bills something twice.
    const original = await caller.billing.get({ propertyId, id: folio.id });
    const moved = await caller.billing.get({ propertyId, id: second.id });

    assert.deepEqual(
      original.lines.map((line) => line.description),
      ["Bar"]
    );
    assert.deepEqual(
      moved.lines.map((line) => line.description),
      ["One night"]
    );
    assert.notEqual(original.number, moved.number);
  });
});

describe("two hands on one bill", () => {
  /**
   * Its own reservation, and one per test.
   *
   * The file's shared one is closed by the cycle above, and these are about
   * what happens to an **open** bill. A test that depends on the order the
   * others ran in is a test that will fail for the wrong reason one day.
   */
  let roomTypeId: number;

  before(async () => {
    const type = await prisma.roomType.findFirstOrThrow({
      where: { propertyId },
      select: { id: true },
    });
    roomTypeId = type.id;
  });

  const freshReservation = async (tag: string) => {
    const reservation = await prisma.reservation.create({
      data: {
        propertyId,
        reference: `BILL-${fx.tag}-${tag}`,
        status: "CHECKED_OUT",
        currencyCode: "EUR",
        stays: {
          create: [
            {
              roomTypeId,
              status: "CHECKED_OUT",
              checkIn: new Date(Date.UTC(2027, 5, 1)),
              checkOut: new Date(Date.UTC(2027, 5, 3)),
              currencyCode: "EUR",
            },
          ],
        },
      },
    });
    return reservation.id;
  };

  /**
   * All three of these read a folio's state and then wrote against it, and the
   * gap between the two statements was wide enough for a second request. None
   * of them crashed in a way anybody would notice — they produced a quietly
   * wrong bill, which is worse.
   */
  test("a double-click takes the money once, and returns the payment rather than a 500", async () => {
    const caller = callerFor(fx.owner);
    const mine = await freshReservation("pay");
    const folio = await caller.billing.folioForReservation({
      propertyId,
      reservationId: mine,
    });

    const key = `pay-${fx.tag}`;
    const attempt = () =>
      caller.billing.takePayment({
        propertyId,
        folioId: folio.id,
        method: "CARD",
        amountMinor: 5_000,
        idempotencyKey: key,
      });

    // Sent together, the way a double-click sends them.
    const [a, b] = await Promise.all([attempt(), attempt()]);

    // Both callers are told about the same payment; neither is handed a
    // duplicate-key error for pressing a button twice.
    assert.equal(a.id, b.id);

    const taken = await prisma.payment.count({ where: { idempotencyKey: key } });
    assert.equal(taken, 1, "the money was taken once");
  });

  test("a line posted while the bill is closing does not vanish from the frozen total", async () => {
    const caller = callerFor(fx.owner);
    const mine = await freshReservation("close");
    const folio = await caller.billing.folioForReservation({
      propertyId,
      reservationId: mine,
    });

    await caller.billing.postLine({
      propertyId,
      folioId: folio.id,
      type: "ROOM",
      description: "A night",
      quantity: 1,
      unitPriceMinor: 10_000,
    });
    await caller.billing.takePayment({
      propertyId,
      folioId: folio.id,
      method: "CARD",
      amountMinor: 10_000,
    });

    /**
     * Closing and posting at once. Either order is legitimate — the line lands
     * first and the close refuses because the bill no longer balances, or the
     * close wins and the line is refused because the bill is shut. What must
     * not happen is both succeeding, which is how `closedTotalMinor` came to
     * exclude a line that is on the folio: the number is deliberately not
     * re-derivable, so it stays wrong for ever.
     */
    const [closing, posting] = await Promise.allSettled([
      caller.billing.close({ propertyId, id: folio.id }),
      caller.billing.postLine({
        propertyId,
        folioId: folio.id,
        type: "EXTRA",
        description: "A late minibar",
        quantity: 1,
        unitPriceMinor: 450,
      }),
    ]);

    if (closing.status === "fulfilled" && posting.status === "fulfilled") {
      assert.fail("a bill closed and took another line in the same instant");
    }

    const after = await prisma.folio.findUniqueOrThrow({
      where: { id: folio.id },
      select: { status: true, closedTotalMinor: true, lines: { select: { amountMinor: true } } },
    });

    // If it closed, the frozen total is every line that was on it.
    if (after.status === "CLOSED") {
      const onIt = after.lines.reduce((total, line) => total + line.amountMinor, 0);
      assert.equal(after.closedTotalMinor, onIt);
    }
  });

  test("a line cannot name a stay from somebody else's booking", async () => {
    const caller = callerFor(fx.owner);
    const mine = await freshReservation("foreign");
    const folio = await caller.billing.folioForReservation({
      propertyId,
      reservationId: mine,
    });

    // A stay that exists and belongs to a different reservation. Accepted
    // without a word before — which also poisons `postRoomCharges`, whose
    // idempotency is "does this stay already have a line".
    const foreign = await prisma.roomStay.findFirstOrThrow({
      where: { reservationId: { not: mine } },
      select: { id: true },
    });

    const error = await caller.billing
      .postLine({
        propertyId,
        folioId: folio.id,
        type: "ROOM",
        description: "Not mine",
        quantity: 1,
        unitPriceMinor: 100,
        roomStayId: foreign.id,
      })
      .then(() => null)
      .catch((e) => e);

    assert.equal(domainCodeOf(error), BillingError.LINE_STAY_FOREIGN);
  });
});
