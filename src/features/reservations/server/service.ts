import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { InvalidError, PreconditionError } from "@/server/errors";
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
  ReservationError,
  searchTerms,
  spanInWindow,
  statusesInView,
  toStayDate,
  type GridSpan,
  type Laned,
  type ListReservationsInput,
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
    /**
     * The caller's own hold, discounted rather than counted.
     *
     * A desk that holds a room and then books it must not be refused by its own
     * claim — the hold exists to keep the room *for this booking*, and counting
     * it here would make taking one strictly worse than taking none.
     */
    exceptHoldKey?: string;
  },
  scope?: AvailabilityScope
): Promise<NightAvailability[]> {
  const from = toStayDate(args.from);
  const to = toStayDate(args.to);
  if (nightsBetween(from, to) < 1) {
    throw new InvalidError(
      ReservationError.STAY_RANGE_INVALID,
      "The range must cover at least one night"
    );
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

  const [rooms, blocks, stays, holds] = await Promise.all([
    /**
     * How many rooms of each type there are — counted, never stored.
     *
     * It used to be `RoomTypeInventory.totalRooms`, and a property set up
     * through the app had no rows at all: a missing row reads as nought, so it
     * was sold out on every night for ever. A stored copy of a count in another
     * table also drifts the moment somebody adds a room, which is the argument
     * this table already made about not storing a sold count.
     *
     * Archived rooms are gone from the count; `OUT_OF_ORDER` ones are not. That
     * status is a state of *now* — a room broken this morning may be fixed by
     * March, and letting it shrink a future night loses bookings that could
     * have been taken. A room genuinely out of service for a period is a block.
     */
    prisma.room.groupBy({
      by: ["roomTypeId"],
      where: { roomTypeId: { in: roomTypeIds }, archivedAt: null },
      _count: { _all: true },
    }),
    // Only the nights somebody deliberately held rooms back on. Most have no
    // row, and that means nothing withheld rather than nothing for sale.
    prisma.roomTypeInventory.findMany({
      where: { roomTypeId: { in: roomTypeIds }, date: { gte: from, lt: to } },
      select: { roomTypeId: true, date: true, blockedRooms: true },
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
        ...(args.exceptHoldKey ? { holdKey: { not: args.exceptHoldKey } } : {}),
      },
      select: { roomTypeId: true, checkIn: true, checkOut: true, quantity: true },
    }),
  ]);

  const key = (roomTypeId: number, date: Date) => `${roomTypeId}:${date.toISOString()}`;

  const totals = new Map(rooms.map((row) => [row.roomTypeId, row._count._all]));
  const blocked = new Map(
    blocks.map((row) => [key(row.roomTypeId, toStayDate(row.date)), row.blockedRooms])
  );

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
      const total = totals.get(roomTypeId) ?? 0;
      // No row is nothing withheld, which is the common case: a block is
      // something somebody did, not something that has to be declared nightly.
      const blockedCount = blocked.get(k) ?? 0;
      const soldCount = sold.get(k) ?? 0;
      const heldCount = held.get(k) ?? 0;

      return {
        date,
        roomTypeId,
        total,
        blocked: blockedCount,
        sold: soldCount,
        held: heldCount,
        available: availableRooms(total, blockedCount, soldCount, heldCount),
      };
    })
  );
}

/**
 * The next number in a series, consumed inside the caller's transaction.
 *
 * **The increment happens in the database, not here.** This used to read the
 * counter, add one, and write the result back — and claimed in a comment that
 * the write was what kept two clerks apart. It was not: under `READ COMMITTED`
 * both transactions read the same counter and both wrote the same number, and
 * the loser died on `folios_propertyId_number_key` with the whole check-out
 * rolled back. Two receptionists checking guests out at the same moment is not
 * an exotic case; it is a Saturday morning.
 *
 * `increment` compiles to `counter = counter + 1`, which takes the row lock and
 * re-reads the committed value — so the second transaction waits and then gets
 * the next number rather than the same one.
 */
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
    throw new PreconditionError(
      ReservationError.SERIES_MISSING,
      `No ${args.kind} number series for this property`
    ).with({ kind: args.kind });
  }

  const format = (counter: number) =>
    `${series.prefix}${String(counter).padStart(series.padding, "0")}`;

  // A yearly series restarts when the period changes. Conditional on the period
  // it is restarting *from*, so that two transactions arriving together on New
  // Year's Day cannot both decide they are the one taking number 1: the second
  // re-evaluates the clause against the committed row, matches nothing, and
  // falls through to the increment below.
  if (series.resetPolicy === "YEARLY" && series.period !== period) {
    const { count } = await tx.numberSeries.updateMany({
      where: { id: series.id, period: series.period },
      data: { counter: 1, period },
    });
    if (count === 1) return format(1);
  }

  const taken = await tx.numberSeries.update({
    where: { id: series.id },
    data: { counter: { increment: 1 } },
    select: { counter: true },
  });

  return format(taken.counter);
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
    throw new InvalidError(
      ReservationError.GRID_WINDOW_INVALID,
      `A grid window is between one and ${GRID_MAX_NIGHTS} nights`
    ).with({ max: GRID_MAX_NIGHTS });
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

/**
 * One word of a search, against everywhere a desk might know a booking from.
 *
 * A name, a room number and a reference are four relations and the caller knows
 * exactly one of them, so the word is offered to all four rather than asking
 * which kind it is.
 */
function matchesTerm(term: string): Prisma.ReservationWhereInput {
  const like = { contains: term, mode: "insensitive" } as const;

  return {
    OR: [
      { reference: like },
      { booker: { OR: [{ firstName: like }, { lastName: like }] } },
      { guests: { some: { person: { OR: [{ firstName: like }, { lastName: like }] } } } },
      { stays: { some: { room: { number: like } } } },
    ],
  };
}

/**
 * Bookings, found without knowing their dates.
 *
 * The grid is bounded by a window and cannot answer "where is the booking for
 * the person on the phone". This is that question, and it is paginated by
 * offset with a total rather than by a cursor because the table it feeds
 * renders a page count.
 */
export async function listReservations(input: ListReservationsInput) {
  const { filter, orderBy, pagination } = input;

  // An explicit status list beats the tab it came from: a filter the desk set
  // is more specific than the tab it set it in.
  const statuses = filter?.status?.length
    ? filter.status
    : filter?.view
      ? statusesInView(filter.view)
      : undefined;

  // One `some`, not two: a booking matches when a *single* stay satisfies both
  // the type and the nights, which is what "a Double, that week" means.
  const stay: Prisma.RoomStayWhereInput = {
    ...(filter?.roomTypeId ? { roomTypeId: filter.roomTypeId } : {}),
    ...(filter?.from && filter?.to
      ? { checkIn: { lt: filter.to }, checkOut: { gt: filter.from } }
      : {}),
  };

  const terms = searchTerms(filter?.search ?? "");

  const where: Prisma.ReservationWhereInput = {
    propertyId: input.propertyId,
    ...(statuses ? { status: { in: [...statuses] } } : {}),
    ...(Object.keys(stay).length > 0 ? { stays: { some: stay } } : {}),
    // Every word must match something, or "Ada Lovelace" finds every Ada.
    ...(terms.length > 0 ? { AND: terms.map(matchesTerm) } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      orderBy: orderBy ? { [orderBy.field]: orderBy.direction } : { bookedAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        publicId: true,
        reference: true,
        status: true,
        bookedAt: true,
        currencyCode: true,
        totalMinor: true,
        booker: { select: { firstName: true, lastName: true } },
        stays: {
          select: {
            checkIn: true,
            checkOut: true,
            roomType: { select: { name: true } },
            room: { select: { number: true } },
          },
          orderBy: { checkIn: "asc" },
        },
      },
    }),
    prisma.reservation.count({ where }),
  ]);

  return {
    items: rows.map((row) => {
      // A reservation arrives when its earliest stay does and ends when its
      // last one does — the same reading `refuseStatusChange` makes.
      const arrival = row.stays.at(0)?.checkIn ?? null;
      const departure = row.stays
        .map((s) => s.checkOut)
        .reduce<Date | null>((latest, end) => (!latest || end > latest ? end : latest), null);

      return {
        id: row.id,
        publicId: row.publicId,
        reference: row.reference,
        status: row.status,
        bookedAt: row.bookedAt,
        currencyCode: row.currencyCode,
        totalMinor: row.totalMinor,
        guestName: row.booker ? personDisplayName(row.booker) : null,
        checkIn: arrival,
        checkOut: departure,
        nights: arrival && departure ? nightsBetween(arrival, departure) : 0,
        roomCount: row.stays.length,
        rooms: row.stays.map((s) => s.room?.number).filter((n): n is string => Boolean(n)),
        roomTypes: [...new Set(row.stays.map((s) => s.roomType.name))],
      };
    }),
    total,
  };
}

/**
 * Holds whose minutes are up.
 *
 * Not a correctness sweep: `availability` already filters on `releaseAt`, so an
 * expired claim stops blocking the moment it expires. This is the rows, which
 * otherwise accumulate one per abandoned search forever — and a table nobody
 * ever deletes from is a table that eventually decides a query plan.
 */
export async function sweepExpiredHolds(now = new Date()): Promise<{ removed: number }> {
  const { count } = await prisma.inventoryHold.deleteMany({ where: { releaseAt: { lte: now } } });
  return { removed: count };
}

/**
 * The predicate again, for the dry run — the same reason `countSweepable`
 * duplicates the storage sweeps': a count that deleted things to count them is
 * not a dry run.
 */
export async function countExpiredHolds(now = new Date()): Promise<number> {
  return prisma.inventoryHold.count({ where: { releaseAt: { lte: now } } });
}
