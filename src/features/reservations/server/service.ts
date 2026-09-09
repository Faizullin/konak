import "server-only";
import { TRPCError } from "@trpc/server";
import prisma from "@/server/db";
import { personDisplayName } from "@/features/directory";
import { compareRoomNumbers } from "@/features/properties";
import {
  assignLanes,
  availableRooms,
  DayRole,
  dayRoleOf,
  GRID_HIDDEN_STATUSES,
  GRID_MAX_NIGHTS,
  gridWindowOf,
  laneCount,
  nightsBetween,
  nightsOf,
  occupiesInventory,
  spanInWindow,
  toStayDate,
  type GridSpan,
  type Laned,
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
 * Rows the caller has already read for the same property and window.
 *
 * `frontDeskGrid` reads both of these to draw with; without this it would read
 * them a second time to count with. Passing a superset is safe — only
 * `occupiesInventory` statuses are counted, and types outside `roomTypeIds`
 * are never emitted.
 */
export type AvailabilityScope = {
  /** Sellable room type ids for the property. Archived types sell nothing. */
  roomTypeIds: number[];
  /** Every stay touching the window, whatever its status. */
  stays: readonly { roomTypeId: number; checkIn: Date; checkOut: Date; status: string }[];
};

/**
 * Free rooms per type per night, derived every time.
 *
 * Sold is counted from stays rather than stored, because a cached count drifts
 * the first time a channel cancels quietly — and a wrong count here is an
 * overbooking, not a stale number.
 */
export async function availability(
  args: {
    propertyId: number;
    roomTypeId?: number;
    from: Date;
    to: Date;
  },
  scope?: AvailabilityScope
): Promise<NightAvailability[]> {
  const from = toStayDate(args.from);
  const to = toStayDate(args.to);
  if (nightsBetween(from, to) < 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The range must cover at least one night",
    });
  }

  const roomTypeIds = scope
    ? scope.roomTypeIds.filter((id) => !args.roomTypeId || id === args.roomTypeId)
    : (
        await prisma.roomType.findMany({
          where: {
            propertyId: args.propertyId,
            archivedAt: null,
            ...(args.roomTypeId ? { id: args.roomTypeId } : {}),
          },
          select: { id: true },
        })
      ).map((t) => t.id);
  if (roomTypeIds.length === 0) return [];

  const nights = nightsOf({ checkIn: from, checkOut: to });

  const [inventory, stays, holds] = await Promise.all([
    prisma.roomTypeInventory.findMany({
      where: { roomTypeId: { in: roomTypeIds }, date: { gte: from, lt: to } },
    }),
    // Every stay that touches the window; each contributes to the nights it
    // actually occupies, not to the whole range.
    scope?.stays ??
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

export type GridStay = Laned<GridSpan> & {
  /** The stay, not the reservation: `assignRoom` and a drag both move this id. */
  id: number;
  reservationId: number;
  publicId: string;
  reference: string;
  status: string;
  roomId: number | null;
  roomTypeId: number;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  guestName: string | null;
};

export type GridRoomRow = {
  roomId: number;
  roomTypeId: number;
  number: string;
  floor: string | null;
  status: string;
  /** How many lanes the row needs. One, unless unconstrained stays overlap in it. */
  lanes: number;
  stays: GridStay[];
};

/** The stays a room type owes but has not placed in a room yet. */
export type GridUnassignedBand = {
  roomTypeId: number;
  lanes: number;
  stays: GridStay[];
};

export type FrontDeskGrid = {
  window: { from: Date; to: Date; nights: Date[] };
  roomTypes: {
    id: number;
    name: string;
    code: string;
    position: number;
    archivedAt: Date | null;
  }[];
  rooms: GridRoomRow[];
  unassigned: GridUnassignedBand[];
  availability: NightAvailability[];
};

/**
 * The whole grid for a window, in one call.
 *
 * Five queries for any number of rooms, not one per room: the rooms, the types
 * they belong to, every stay that touches the window, and then the inventory
 * and holds that turn those stays into a free-room count. Whether that stays
 * fast enough — or wants a read model — is the measurement `roadmap.md` puts in
 * this phase, and it can only be made against a query that exists.
 *
 * The layout is done here rather than in the component because it is the same
 * arithmetic the drag has to undo, and `model/` proves it without a browser.
 */
export async function frontDeskGrid(args: {
  propertyId: number;
  from: Date;
  to: Date;
}): Promise<FrontDeskGrid> {
  const window = gridWindowOf(args.from, args.to);
  if (!window) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `A grid window is between one and ${GRID_MAX_NIGHTS} nights`,
    });
  }

  const from = window.from;
  const to = toStayDate(args.to);

  const [rooms, roomTypes, stays] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId: args.propertyId, archivedAt: null },
      select: { id: true, number: true, floor: true, status: true, roomTypeId: true },
    }),
    // Archived types are included, unlike everywhere else: archiving one does
    // not cancel the stays already sold on it, and a type the grid cannot name
    // is a booking it cannot draw. It carries `archivedAt` so the screen can
    // say so and refuse to sell more.
    prisma.roomType.findMany({
      where: { propertyId: args.propertyId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, position: true, archivedAt: true },
    }),
    // Columns are named rather than taken wholesale: this is every stay in a
    // month for a whole hotel, and adding a column should be a decision.
    prisma.roomStay.findMany({
      where: {
        reservation: { propertyId: args.propertyId },
        checkIn: { lt: to },
        checkOut: { gt: from },
        status: { notIn: [...GRID_HIDDEN_STATUSES] },
      },
      select: {
        id: true,
        reservationId: true,
        roomId: true,
        roomTypeId: true,
        status: true,
        checkIn: true,
        checkOut: true,
        adults: true,
        children: true,
        reservation: {
          select: {
            publicId: true,
            reference: true,
            booker: { select: { firstName: true, lastName: true } },
          },
        },
      },
    }),
  ]);

  // Counted from the rows just read rather than read again: same property, same
  // window. Archived types are excluded here because they sell nothing, even
  // though the grid still draws the stays already on them.
  const nightly = await availability(
    { propertyId: args.propertyId, from, to },
    {
      roomTypeIds: roomTypes.flatMap((type) => (type.archivedAt ? [] : [type.id])),
      stays,
    }
  );

  const drawn = stays.flatMap((stay) => {
    const span = spanInWindow(stay, window);
    // A stay the query returned but the window cannot draw would be a bug in
    // one of the two; dropping it keeps the contract "every span is visible".
    if (!span) return [];

    return [
      {
        ...span,
        id: stay.id,
        reservationId: stay.reservationId,
        publicId: stay.reservation.publicId,
        reference: stay.reservation.reference,
        status: stay.status,
        roomId: stay.roomId,
        roomTypeId: stay.roomTypeId,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        adults: stay.adults,
        children: stay.children,
        guestName: stay.reservation.booker ? personDisplayName(stay.reservation.booker) : null,
      },
    ];
  });

  const byRoom = new Map<number, (typeof drawn)[number][]>();
  const byType = new Map<number, (typeof drawn)[number][]>();
  for (const stay of drawn) {
    const bucket = stay.roomId === null ? byType : byRoom;
    const key = stay.roomId ?? stay.roomTypeId;
    bucket.set(key, [...(bucket.get(key) ?? []), stay]);
  }

  const laned = (spans: (typeof drawn)[number][]) => {
    const rows = assignLanes(spans);
    return { lanes: laneCount(rows), stays: rows };
  };

  return {
    window: { from, to, nights: nightsOf({ checkIn: from, checkOut: to }) },
    roomTypes,
    // The corridor's order, which Postgres cannot give: room numbers are strings.
    rooms: rooms
      .toSorted((a, b) => compareRoomNumbers(a.number, b.number))
      .map((room) => ({
        roomId: room.id,
        roomTypeId: room.roomTypeId,
        number: room.number,
        floor: room.floor,
        status: room.status,
        ...laned(byRoom.get(room.id) ?? []),
      })),
    // A band per type, in the same order as the types themselves, and only
    // where something is actually waiting to be placed.
    unassigned: roomTypes.flatMap((type) => {
      const waiting = byType.get(type.id);
      return waiting ? [{ roomTypeId: type.id, ...laned(waiting) }] : [];
    }),
    availability: nightly,
  };
}

export type DayStay = {
  id: number;
  reservationId: number;
  publicId: string;
  reference: string;
  status: string;
  role: DayRole;
  roomId: number | null;
  roomNumber: string | null;
  roomTypeId: number;
  roomTypeName: string;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  adults: number;
  children: number;
  guestName: string | null;
};

export type FrontDeskDayList = {
  day: Date;
  arrivals: DayStay[];
  departures: DayStay[];
  inHouse: DayStay[];
};

/**
 * The three lists a receptionist works from, for one day.
 *
 * One query for all three: a stay touching the day is in exactly one of them,
 * and `dayRoleOf` in `model/` decides which without a second read. The bounds
 * are the only place `checkOut` is treated as inclusive — a departure is not a
 * night, but it is the morning's work.
 */
export async function frontDeskDay(args: {
  propertyId: number;
  day: Date;
}): Promise<FrontDeskDayList> {
  const day = toStayDate(args.day);

  const stays = await prisma.roomStay.findMany({
    where: {
      reservation: { propertyId: args.propertyId },
      checkIn: { lte: day },
      checkOut: { gte: day },
      status: { notIn: [...GRID_HIDDEN_STATUSES] },
    },
    select: {
      id: true,
      reservationId: true,
      roomId: true,
      roomTypeId: true,
      status: true,
      checkIn: true,
      checkOut: true,
      adults: true,
      children: true,
      room: { select: { number: true } },
      roomType: { select: { name: true } },
      reservation: {
        select: {
          publicId: true,
          reference: true,
          booker: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  const rows = stays.flatMap((stay) => {
    const role = dayRoleOf(stay, day);
    // The query bounds already exclude anything roleless; dropping it keeps
    // "every row is in one list" true rather than assuming it.
    if (!role) return [];

    return [
      {
        id: stay.id,
        reservationId: stay.reservationId,
        publicId: stay.reservation.publicId,
        reference: stay.reservation.reference,
        status: stay.status,
        role,
        roomId: stay.roomId,
        roomNumber: stay.room?.number ?? null,
        roomTypeId: stay.roomTypeId,
        roomTypeName: stay.roomType.name,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        nights: nightsBetween(stay.checkIn, stay.checkOut),
        adults: stay.adults,
        children: stay.children,
        guestName: stay.reservation.booker ? personDisplayName(stay.reservation.booker) : null,
      },
    ];
  });

  // Unassigned first: a stay with no room is the work, and burying it under
  // fifty assigned rows is how it gets missed. The rest in corridor order.
  const ordered = (role: DayRole) =>
    rows
      .filter((row) => row.role === role)
      .toSorted((a, b) => {
        if ((a.roomNumber === null) !== (b.roomNumber === null)) return a.roomNumber ? 1 : -1;
        if (a.roomNumber && b.roomNumber) return compareRoomNumbers(a.roomNumber, b.roomNumber);
        return a.reference.localeCompare(b.reference);
      });

  return {
    day,
    arrivals: ordered(DayRole.ARRIVAL),
    departures: ordered(DayRole.DEPARTURE),
    inHouse: ordered(DayRole.IN_HOUSE),
  };
}
