import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../src/env.mjs";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * A hotel worth showing.
 *
 * Separate from `prisma/seed.ts` on purpose. The seed is the minimal chain that
 * proves the model holds — one type, two rooms, one booking — and it is what a
 * fresh clone and the tests want. This is the other thing: a property with
 * enough in it that a demonstration never opens onto an empty screen.
 *
 *   npm run db:seed && npm run demo
 *
 * Re-runnable. Everything it creates is referenced `DEMO-…`, and it deletes its
 * own previous run first — so a demonstration always starts from the same
 * picture rather than from whatever the last one left behind.
 *
 * Its own client rather than `src/server/db`: that module's default export
 * arrives here as a module record, because `.mts` is real ESM and `src/` is
 * loaded as CommonJS. The other scripts import named things and never see it.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

const TAG = "DEMO";
const HORIZON = 90;

/** UTC midnight `offset` days from today — how a stay date is stored. */
const day = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
};

const property = await prisma.property.findFirstOrThrow({
  where: { slug: "seaside" },
  select: { id: true, organizationId: true, currencyCode: true },
});

/* -- last time ------------------------------------------------------------- */

const previous = await prisma.reservation.findMany({
  where: { propertyId: property.id, reference: { startsWith: TAG } },
  select: { id: true, bookerPersonId: true },
});

if (previous.length > 0) {
  // Reservations first: `ReservationGuest.person` is Restrict, so a person
  // cannot go while a booking still points at them.
  await prisma.reservation.deleteMany({ where: { id: { in: previous.map((r) => r.id) } } });
  const people = previous.map((r) => r.bookerPersonId).filter((id) => id !== null);
  if (people.length > 0) await prisma.person.deleteMany({ where: { id: { in: people } } });
  console.log(`cleared ${previous.length} booking(s) from the last run`);
}

/* -- what there is to sell ------------------------------------------------- */

const TYPES = [
  {
    code: "DBL",
    name: "Double Room",
    base: 2,
    max: 3,
    price: 12_000,
    rooms: ["101", "102", "103", "104"],
  },
  {
    code: "SGL",
    name: "Single Room",
    base: 1,
    max: 1,
    price: 8_000,
    rooms: ["201", "202", "203", "204"],
  },
  { code: "FAM", name: "Family Suite", base: 2, max: 4, price: 19_000, rooms: ["301", "302"] },
] as const;

type Code = (typeof TYPES)[number]["code"];

const typeIds = new Map<Code, number>();

for (const spec of TYPES) {
  const roomType = await prisma.roomType.upsert({
    where: { propertyId_code: { propertyId: property.id, code: spec.code } },
    update: { name: spec.name },
    create: {
      propertyId: property.id,
      name: spec.name,
      code: spec.code,
      baseOccupancy: spec.base,
      maxOccupancy: spec.max,
      maxAdults: spec.max,
      maxChildren: spec.max - spec.base,
    },
  });
  typeIds.set(spec.code, roomType.id);

  for (const number of spec.rooms) {
    await prisma.room.upsert({
      where: { propertyId_number: { propertyId: property.id, number } },
      update: { roomTypeId: roomType.id },
      create: {
        propertyId: property.id,
        roomTypeId: roomType.id,
        number,
        floor: number.slice(0, 1),
      },
    });
  }

  // A night with no inventory row is nought rooms, deliberately — so the
  // horizon has to be declared or the grid is a wall of sold-out nights.
  for (let i = -1; i < HORIZON; i += 1) {
    await prisma.roomTypeInventory.upsert({
      where: { roomTypeId_date: { roomTypeId: roomType.id, date: day(i) } },
      update: { totalRooms: spec.rooms.length },
      create: { roomTypeId: roomType.id, date: day(i), totalRooms: spec.rooms.length },
    });
  }
}

const plan = await prisma.ratePlan.findFirstOrThrow({
  where: { propertyId: property.id },
  select: { id: true },
});

for (const spec of TYPES) {
  const roomTypeId = typeIds.get(spec.code)!;
  for (let i = -1; i < HORIZON; i += 1) {
    const date = day(i);
    // Friday and Saturday cost more, so the calendar reads as a calendar and a
    // quote is visibly the sum of its nights rather than a rate times a number.
    const weekend = date.getUTCDay() === 5 || date.getUTCDay() === 6;
    await prisma.rateCalendar.upsert({
      where: { ratePlanId_roomTypeId_date: { ratePlanId: plan.id, roomTypeId, date } },
      update: { priceMinor: weekend ? Math.round(spec.price * 1.25) : spec.price },
      create: {
        ratePlanId: plan.id,
        roomTypeId,
        date,
        priceMinor: weekend ? Math.round(spec.price * 1.25) : spec.price,
      },
    });
  }
}

/* -- who is staying -------------------------------------------------------- */

const roomIds = new Map(
  (
    await prisma.room.findMany({
      where: { propertyId: property.id },
      select: { id: true, number: true },
    })
  ).map((room) => [room.number, room.id])
);

let counter = 0;

async function book(spec: {
  first: string;
  last: string;
  code: Code;
  /** Null is a booking nobody has given a room to yet — normal, and drawn apart. */
  room: string | null;
  from: number;
  nights: number;
  status: string;
  adults?: number;
  /** Pass a previous booking's guest to give them a history. */
  personId?: number;
}) {
  counter += 1;

  const personId =
    spec.personId ??
    (
      await prisma.person.create({
        data: {
          organizationId: property.organizationId,
          firstName: spec.first,
          lastName: spec.last,
        },
        select: { id: true },
      })
    ).id;

  const nightly = TYPES.find((type) => type.code === spec.code)!.price;
  const totalMinor = nightly * spec.nights;

  await prisma.reservation.create({
    data: {
      propertyId: property.id,
      reference: `${TAG}-${String(counter).padStart(4, "0")}`,
      status: spec.status,
      source: "DIRECT",
      bookerPersonId: personId,
      currencyCode: property.currencyCode,
      totalMinor,
      guests: { create: [{ personId, isPrimary: true }] },
      stays: {
        create: [
          {
            roomTypeId: typeIds.get(spec.code)!,
            ratePlanId: plan.id,
            roomId: spec.room ? (roomIds.get(spec.room) ?? null) : null,
            status: spec.status,
            checkIn: day(spec.from),
            checkOut: day(spec.from + spec.nights),
            adults: spec.adults ?? 2,
            currencyCode: property.currencyCode,
            totalMinor,
          },
        ],
      },
    },
  });

  return personId;
}

// Someone who has been here before. Three stays behind her is what makes the
// guest record worth opening at all.
const regular = { first: "Мария", last: "Иванова" };
const regularId = await book({
  ...regular,
  code: "DBL",
  room: "101",
  from: -40,
  nights: 3,
  status: "CHECKED_OUT",
});
await book({
  ...regular,
  code: "DBL",
  room: "102",
  from: -22,
  nights: 2,
  status: "CHECKED_OUT",
  personId: regularId,
});
await book({
  ...regular,
  code: "FAM",
  room: "301",
  from: -9,
  nights: 4,
  status: "CHECKED_OUT",
  personId: regularId,
});

// In house — mid-stay, so the chip crosses today's line rather than starting on it.
await book({
  first: "Дмитрий",
  last: "Соколов",
  code: "DBL",
  room: "103",
  from: -2,
  nights: 4,
  status: "CHECKED_IN",
});
await book({
  first: "Анна",
  last: "Кузнецова",
  code: "SGL",
  room: "201",
  from: -1,
  nights: 3,
  status: "CHECKED_IN",
  adults: 1,
});

// Out this morning, in this afternoon, same room: the same-day turnover the
// half-open interval permits and the diagonal seam exists to draw.
await book({
  first: "Олег",
  last: "Волков",
  code: "SGL",
  room: "202",
  from: -3,
  nights: 3,
  status: "CHECKED_OUT",
  adults: 1,
});
await book({
  first: "Елена",
  last: "Морозова",
  code: "SGL",
  room: "202",
  from: 0,
  nights: 2,
  status: "CONFIRMED",
  adults: 1,
});

// Arriving today with no room yet — an unassigned band, and a check-in to
// perform live.
await book({
  first: "Игорь",
  last: "Лебедев",
  code: "DBL",
  room: null,
  from: 0,
  nights: 2,
  status: "CONFIRMED",
});

// And a second turnover, a few nights out.
//
// The one in 202 happens today, so the departing stay's last night falls the
// day *before* the window opens and only the arrival is drawn — true to the
// model and useless as a demonstration. This one has both halves on screen,
// which is what makes the diagonal seam something anybody can see.
await book({
  first: "Наталья",
  last: "Орлова",
  code: "SGL",
  room: "203",
  from: 2,
  nights: 3,
  status: "CONFIRMED",
  adults: 1,
});
await book({
  first: "Сергей",
  last: "Фёдоров",
  code: "SGL",
  room: "203",
  from: 5,
  nights: 2,
  status: "CONFIRMED",
  adults: 1,
});

// The near future, so the window is not empty to the right.
await book({
  first: "Светлана",
  last: "Попова",
  code: "FAM",
  room: "302",
  from: 3,
  nights: 5,
  status: "CONFIRMED",
});
await book({
  first: "Артём",
  last: "Новиков",
  code: "DBL",
  room: "104",
  from: 6,
  nights: 2,
  status: "CONFIRMED",
});
await book({
  first: "Юлия",
  last: "Зайцева",
  code: "SGL",
  room: null,
  from: 11,
  nights: 3,
  status: "ENQUIRY",
  adults: 1,
});

// The two endings. Neither occupies a room — that is the point of them — but
// both are in the bookings list under Archive.
await book({
  first: "Павел",
  last: "Егоров",
  code: "DBL",
  room: null,
  from: 4,
  nights: 2,
  status: "CANCELLED",
});
await book({
  first: "Ирина",
  last: "Белова",
  code: "SGL",
  room: null,
  from: -5,
  nights: 1,
  status: "NO_SHOW",
  adults: 1,
});

console.log(
  `demo ready — ${TYPES.length} room types, ${roomIds.size} rooms, ${HORIZON} nights priced, ${counter} bookings`
);

await prisma.$disconnect();
