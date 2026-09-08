import "server-only";
import { TRPCError } from "@trpc/server";
import prisma from "@/server/db";
import {
  availableRooms,
  nightsBetween,
  nightsOf,
  occupiesInventory,
  toStayDate,
  type StayRange,
} from "../model";

/**
 * Availability, and the transaction that consumes it.
 *
 * This has a service because it owns a multi-step transaction and an invariant
 * — the threshold `architecture.md` states. The rules themselves are in
 * `model/`; what lives here is the reading and writing they need.
 */

export type NightAvailability = {
  date: Date;
  roomTypeId: number;
  total: number;
  blocked: number;
  sold: number;
  held: number;
  available: number;
};

/**
 * Free rooms per type per night, derived every time.
 *
 * Sold is counted from stays rather than stored, because a cached count drifts
 * the first time a channel cancels quietly — and a wrong count here is an
 * overbooking, not a stale number.
 */
export async function availability(args: {
  propertyId: number;
  roomTypeId?: number;
  from: Date;
  to: Date;
}): Promise<NightAvailability[]> {
  const from = toStayDate(args.from);
  const to = toStayDate(args.to);
  if (nightsBetween(from, to) < 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The range must cover at least one night",
    });
  }

  const roomTypes = await prisma.roomType.findMany({
    where: {
      propertyId: args.propertyId,
      archivedAt: null,
      ...(args.roomTypeId ? { id: args.roomTypeId } : {}),
    },
    select: { id: true },
  });
  if (roomTypes.length === 0) return [];

  const roomTypeIds = roomTypes.map((t) => t.id);
  const nights = nightsOf({ checkIn: from, checkOut: to });

  const [inventory, stays, holds] = await Promise.all([
    prisma.roomTypeInventory.findMany({
      where: { roomTypeId: { in: roomTypeIds }, date: { gte: from, lt: to } },
    }),
    // Every stay that touches the window; each contributes to the nights it
    // actually occupies, not to the whole range.
    prisma.roomStay.findMany({
      where: {
        roomTypeId: { in: roomTypeIds },
        checkIn: { lt: to },
        checkOut: { gt: from },
      },
      select: { roomTypeId: true, checkIn: true, checkOut: true, status: true },
    }),
    prisma.inventoryHold.findMany({
      where: {
        roomTypeId: { in: roomTypeIds },
        checkIn: { lt: to },
        checkOut: { gt: from },
        releaseAt: { gt: new Date() },
      },
      select: { roomTypeId: true, checkIn: true, checkOut: true, quantity: true },
    }),
  ]);

  const key = (roomTypeId: number, date: Date) => `${roomTypeId}:${date.toISOString()}`;

  const totals = new Map(inventory.map((row) => [key(row.roomTypeId, toStayDate(row.date)), row]));

  const sold = new Map<string, number>();
  for (const stay of stays) {
    if (!occupiesInventory(stay.status)) continue;
    for (const night of nightsOf(stay as StayRange)) {
      const k = key(stay.roomTypeId, night);
      sold.set(k, (sold.get(k) ?? 0) + 1);
    }
  }

  const held = new Map<string, number>();
  for (const hold of holds) {
    for (const night of nightsOf(hold as StayRange)) {
      const k = key(hold.roomTypeId, night);
      held.set(k, (held.get(k) ?? 0) + hold.quantity);
    }
  }

  return roomTypeIds.flatMap((roomTypeId) =>
    nights.map((date) => {
      const k = key(roomTypeId, date);
      const row = totals.get(k);
      // No inventory row means none declared for that night, which is zero
      // rooms rather than unlimited.
      const total = row?.totalRooms ?? 0;
      const blocked = row?.blockedRooms ?? 0;
      const soldCount = sold.get(k) ?? 0;
      const heldCount = held.get(k) ?? 0;

      return {
        date,
        roomTypeId,
        total,
        blocked,
        sold: soldCount,
        held: heldCount,
        available: availableRooms(total, blocked, soldCount, heldCount),
      };
    })
  );
}

/** The next number in a series, consumed inside the caller's transaction. */
export async function nextSeriesNumber(
  tx: Pick<typeof prisma, "numberSeries">,
  args: { organizationId: number; propertyId: number; kind: string }
): Promise<string> {
  const period = String(new Date().getUTCFullYear());

  const series = await tx.numberSeries.findUnique({
    where: {
      organizationId_propertyId_kind: {
        organizationId: args.organizationId,
        propertyId: args.propertyId,
        kind: args.kind,
      },
    },
  });
  if (!series) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `No ${args.kind} number series for this property`,
    });
  }

  // A yearly series restarts when the period changes; the update is what makes
  // two clerks saving at once take different numbers.
  const reset = series.resetPolicy === "YEARLY" && series.period !== period;
  const counter = reset ? 1 : series.counter + 1;

  await tx.numberSeries.update({
    where: { id: series.id },
    data: { counter, period: reset ? period : series.period },
  });

  return `${series.prefix}${String(counter).padStart(series.padding, "0")}`;
}
