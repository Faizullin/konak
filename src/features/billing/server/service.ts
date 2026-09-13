import "server-only";
import type { Prisma } from "@/generated/prisma/client";
// The service module, not `@/features/reservations/server` — that barrel
// re-exports the router, the router enqueues a channel push, and importing it
// from here closes a cycle Node refuses to instantiate. The barrel is the
// convention; a cycle is the exception to it.
import { lockReservation, nextSeriesNumber } from "@/features/reservations/server/service";
import { FolioStatus, LineType, priceLine } from "../model";

/**
 * Opening a bill and putting the room on it.
 *
 * Separate from the router because check-out calls it: a departure makes the
 * room dirty, owes the floor a clean, **and** makes the bill real, and all
 * three belong in the transaction that records the departure rather than in
 * three things somebody has to remember to do afterwards.
 */

type Tx = Prisma.TransactionClient;

/**
 * Hold one bill still while something decides what may be done to it.
 *
 * Three procedures read a folio's state and then write against it — post a
 * line, take a payment, close it — and each pair of statements has a gap a
 * second request fits into. What comes out of the gap is not a crash but a
 * quietly wrong bill:
 *
 * - a line posted onto a folio that was closed a moment earlier;
 * - a closing total frozen without a line that had just been posted, and
 *   `closedTotalMinor` is deliberately not re-derivable, so the number stays
 *   wrong for ever;
 * - a double-click taking the money twice, or raising a duplicate-key 500 at
 *   somebody who pressed a button once and saw nothing happen.
 *
 * Same shape as `lockRoomType` and `lockReservation`: take the row lock, then
 * decide, inside the transaction that writes.
 */
export async function lockFolio(tx: Prisma.TransactionClient, folioId: number): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "folios" WHERE "id" = ${folioId} FOR UPDATE`;
}

/**
 * The reservation's folio, opened if it has none.
 *
 * `VOID` does not count as having one — a bill raised in error and voided
 * leaves the stay needing a real one.
 */
export async function openFolioFor(
  tx: Tx,
  args: {
    organizationId: number;
    propertyId: number;
    reservationId: number;
    currencyCode: string;
    userId?: string;
  }
): Promise<{ id: number; created: boolean }> {
  // Decide under the lock, or two callers both decide there is none.
  await lockReservation(tx, args.reservationId);

  const existing = await tx.folio.findFirst({
    where: { reservationId: args.reservationId, status: { not: FolioStatus.VOID } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const number = await nextSeriesNumber(tx, {
    organizationId: args.organizationId,
    propertyId: args.propertyId,
    kind: "FOLIO",
  });

  const folio = await tx.folio.create({
    data: {
      propertyId: args.propertyId,
      reservationId: args.reservationId,
      number,
      currencyCode: args.currencyCode,
      createdById: args.userId,
      updatedById: args.userId,
    },
    select: { id: true },
  });

  return { id: folio.id, created: true };
}

/**
 * The room, on the bill.
 *
 * One line per stay, at the total the stay was quoted — the price the guest
 * agreed to, not today's rate, which is the same reason `Reservation` stores a
 * total rather than re-deriving one.
 *
 * **Idempotent by the stay.** Posting again is a second charge for the same
 * nights, and a departure that is recorded twice must not bill twice — so a
 * stay that already has an unvoided room line is skipped.
 */
export async function postRoomCharges(
  tx: Tx,
  args: {
    folioId: number;
    userId?: string;
    stays: readonly { id: number; totalMinor: number; checkIn: Date }[];
  }
): Promise<number> {
  if (args.stays.length === 0) return 0;

  const already = await tx.folioLine.findMany({
    where: {
      folioId: args.folioId,
      type: LineType.ROOM,
      voidedAt: null,
      roomStayId: { in: args.stays.map((stay) => stay.id) },
    },
    select: { roomStayId: true },
  });
  const billed = new Set(already.map((line) => line.roomStayId));

  // A stay quoted at nothing is a room with no price attached — a real case at
  // a front desk — and a zero line on a bill is noise.
  const owing = args.stays.filter((stay) => !billed.has(stay.id) && stay.totalMinor !== 0);
  if (owing.length === 0) return 0;

  const { count } = await tx.folioLine.createMany({
    data: owing.map((stay) => {
      // Tax is already inside the quoted total, so the line carries no rate of
      // its own: inventing one here would change what the guest was told.
      const amounts = priceLine({ quantity: 1, unitPriceMinor: stay.totalMinor });
      return {
        folioId: args.folioId,
        type: LineType.ROOM,
        description: "Accommodation",
        quantity: 1,
        unitPriceMinor: stay.totalMinor,
        taxAmountMinor: amounts.taxAmountMinor,
        amountMinor: amounts.amountMinor,
        roomStayId: stay.id,
        serviceDate: stay.checkIn,
        postedById: args.userId,
      };
    }),
  });

  return count;
}
