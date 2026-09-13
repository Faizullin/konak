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
