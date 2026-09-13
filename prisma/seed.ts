import "dotenv/config";
import { UserRole } from "../src/features/identity/model";
import { OrgRole } from "../src/features/organizations/model";
import { newStorageKey } from "../src/features/platform/model";
import { env } from "../src/env.mjs";
import { auth } from "../src/server/auth";
import prisma from "../src/server/db";
import { storage } from "../src/lib/storage";

/** The smallest thing that is genuinely a PDF, so the sniffer agrees with the row. */
const DEMO_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "latin1"
);

/**
 * Demo data for a fresh clone: a clone with an empty database and a
 * hand-rolled sign-up flow is a poor first run.
 *
 * Every account uses the same password so the README can print one line
 * instead of a table. That is also why this refuses to run in production.
 *
 * `import "dotenv/config"` is the one concession to running outside Next.js —
 * `env.mjs` reads `process.env`, and nothing has populated it in a bare `tsx`
 * process. `prisma.config.ts` does the same thing for the same reason.
 *
 * What is deliberately **not** seeded: rows that only a real flow produces —
 * holds, outbox tasks, guest tokens, door credentials, fiscal receipts,
 * registrations, channel connections, exchange rates. Faking them would make
 * screens look finished while the flow that fills them does not exist.
 *
 * `identity_documents` is left empty on purpose and not merely by omission:
 * `numberEncrypted` is named for an obligation the code does not yet meet, and
 * seeding a passport number in clear would set exactly the wrong example.
 *
 * Import discipline: this reaches only into `src/server`, and the `model`
 * directory of a feature. Neither carries `import "server-only"`, so it runs
 * under plain `tsx` with no flags. Importing a feature's `server` directory
 * would change that — see `docs/guides/local-development.md`.
 */

// Not a common password: `haveIBeenPwned()` in `auth.ts` rejects anything
// that appears in a breach corpus, which "password123" very much does.
const PASSWORD = "konak-demo-pw";

/** ISO 4217. `minorUnits` is what keeps integer money arithmetic honest. */
const CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$", minorUnits: 2 },
  { code: "EUR", name: "Euro", symbol: "€", minorUnits: 2 },
  { code: "KZT", name: "Kazakhstani Tenge", symbol: "₸", minorUnits: 2 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", minorUnits: 0 },
];

const USERS = [
  { email: "admin@konak.dev", name: "Ada Admin", role: UserRole.ADMIN },
  { email: "mod@konak.dev", name: "Mo Moderator", role: UserRole.MODERATOR },
  { email: "user@konak.dev", name: "Uma User", role: UserRole.USER },
];

async function main() {
  if (env.NODE_ENV === "production") {
    throw new Error("The seed writes accounts with a known password. Not in production.");
  }

  let created = 0;

  for (const { email, name, role } of USERS) {
    // Re-running is a no-op rather than an error, so this is safe to call
    // after adding a user to the list above.
    if (await prisma.user.findUnique({ where: { email } })) continue;

    // signUpEmail, not prisma.user.create — it is what writes the hashed
    // credential into `accounts`. A user row inserted directly through Prisma
    // has no password and can never sign in.
    const { user } = await auth.api.signUpEmail({
      body: { email, name, password: PASSWORD },
    });

    // `role` is an `input: false` field, so it cannot arrive through
    // signUpEmail — it is set here, straight through Prisma, on purpose.
    if (role !== UserRole.USER) {
      await prisma.user.update({ where: { id: user.id }, data: { role } });
    }

    created += 1;
  }

  const owner = await prisma.user.findUniqueOrThrow({ where: { email: "admin@konak.dev" } });
  const member = await prisma.user.findUniqueOrThrow({ where: { email: "user@konak.dev" } });

  const organization = await prisma.organization.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      name: "Acme Inc",
      slug: "acme",
      description: "Demo organization created by the seed script.",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: OrgRole.OWNER },
          { userId: member.id, role: OrgRole.MEMBER },
        ],
      },
    },
  });

  // Reference data, not tenant data: the same list for every organization.
  for (const currency of CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: {},
      create: currency,
    });
  }

  // One property, one guest, and one of everything the platform tables carry —
  // enough to prove the core composes before any reservation exists.
  const property = await prisma.property.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "seaside" } },
    update: {},
    create: {
      organization: { connect: { id: organization.id } },
      name: "Seaside Hotel",
      slug: "seaside",
      timezone: "Europe/Berlin",
      currencyCode: "EUR",
      createdById: owner.id,
      updatedById: owner.id,
      address: {
        create: { line1: "1 Harbour Road", city: "Kiel", countryCode: "DE" },
      },
    },
  });

  const guest = await prisma.person.upsert({
    where: { organizationId_email: { organizationId: organization.id, email: "ada@example.com" } },
    update: {},
    create: {
      organization: { connect: { id: organization.id } },
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "+49 431 000000",
      createdById: owner.id,
      updatedById: owner.id,
    },
  });

  const tag = await prisma.tag.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: "VIP" } },
    update: {},
    create: { organizationId: organization.id, name: "VIP", colour: "#c084fc" },
  });

  await prisma.entityTag.upsert({
    where: { tagId_personId: { tagId: tag.id, personId: guest.id } },
    update: {},
    create: { tagId: tag.id, personId: guest.id },
  });

  // `clientEventId` is the idempotency key: re-running must not duplicate it.
  await prisma.activity.upsert({
    where: { clientEventId: "seed-activity-1" },
    update: {},
    create: {
      organizationId: organization.id,
      type: "NOTE",
      subject: "Prefers a quiet room away from the lift",
      personId: guest.id,
      propertyId: property.id,
      ownerUserId: owner.id,
      createdById: owner.id,
      clientEventId: "seed-activity-1",
    },
  });

  // The PMS core, end to end: a type with two rooms, a plan that prices it, and
  // one booked stay — enough to prove the chain holds before any UI exists.
  const roomType = await prisma.roomType.upsert({
    where: { propertyId_code: { propertyId: property.id, code: "DBL" } },
    update: {},
    create: {
      propertyId: property.id,
      name: "Double Room",
      code: "DBL",
      baseOccupancy: 2,
      maxOccupancy: 3,
      maxAdults: 2,
      maxChildren: 1,
      createdById: owner.id,
      updatedById: owner.id,
    },
  });

  for (const number of ["101", "102"]) {
    await prisma.room.upsert({
      where: { propertyId_number: { propertyId: property.id, number } },
      update: {},
      create: {
        propertyId: property.id,
        roomTypeId: roomType.id,
        number,
        floor: "1",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
  }

  const ratePlan = await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId: property.id, code: "BAR" } },
    update: {},
    create: {
      propertyId: property.id,
      roomTypeId: roomType.id,
      name: "Best Available Rate",
      code: "BAR",
      currencyCode: "EUR",
      mealPlan: "BREAKFAST",
      extraAdultMinor: 2500,
      createdById: owner.id,
      updatedById: owner.id,
    },
  });

  /**
   * Date-only: UTC midnight of the property-local day, counted from **today**.
   *
   * Fixed dates rot. Three nights in September 2026 left the demo with a grid of
   * empty columns the moment that week passed — a night with no
   * `RoomTypeInventory` row is nought rooms, deliberately, so an undeclared day
   * is not on sale and the booking dialog honestly reports nothing free.
   */
  const today = new Date();
  const day = (offset: number) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset));

  /**
   * A quarter ahead, which is longer than the grid's own 62-night cap and about
   * as far out as a hotel takes bookings at the desk. Yesterday too, so the
   * arithmetic either side of today is visible.
   */
  const SEED_NIGHTS = 90;

  for (let i = -1; i < SEED_NIGHTS; i += 1) {
    await prisma.rateCalendar.upsert({
      where: {
        ratePlanId_roomTypeId_date: {
          ratePlanId: ratePlan.id,
          roomTypeId: roomType.id,
          date: day(i),
        },
      },
      update: {},
      create: {
        ratePlanId: ratePlan.id,
        roomTypeId: roomType.id,
        date: day(i),
        priceMinor: 12000,
      },
    });

    await prisma.roomTypeInventory.upsert({
      where: { roomTypeId_date: { roomTypeId: roomType.id, date: day(i) } },
      update: {},
      create: { roomTypeId: roomType.id, date: day(i), totalRooms: 2 },
    });
  }

  // A folio number is a legal number, so it comes from a series too — and a
  // property without one cannot bill at all, which is why the seed writes it
  // beside the reservation series rather than leaving it to be discovered.
  await prisma.numberSeries.upsert({
    where: {
      organizationId_propertyId_kind: {
        organizationId: organization.id,
        propertyId: property.id,
        kind: "FOLIO",
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      propertyId: property.id,
      kind: "FOLIO",
      prefix: "SEA-F-",
      period: "2026",
      counter: 0,
    },
  });

  await prisma.numberSeries.upsert({
    where: {
      organizationId_propertyId_kind: {
        organizationId: organization.id,
        propertyId: property.id,
        kind: "RESERVATION",
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      propertyId: property.id,
      kind: "RESERVATION",
      prefix: "SEA-",
      period: "2026",
      counter: 1,
    },
  });

  await prisma.reservation.upsert({
    where: { propertyId_reference: { propertyId: property.id, reference: "SEA-00001" } },
    update: {},
    create: {
      propertyId: property.id,
      reference: "SEA-00001",
      status: "CONFIRMED",
      source: "DIRECT",
      bookerPersonId: guest.id,
      currencyCode: "EUR",
      totalMinor: 24000,
      createdById: owner.id,
      updatedById: owner.id,
      stays: {
        create: [
          {
            roomTypeId: roomType.id,
            ratePlanId: ratePlan.id,
            roomId: null,
            status: "CONFIRMED",
            checkIn: day(0),
            checkOut: day(2),
            adults: 2,
            currencyCode: "EUR",
            totalMinor: 24000,
          },
        ],
      },
      guests: { create: [{ personId: guest.id, isPrimary: true }] },
    },
  });

  // The money chain: a bill, its frozen lines, and what was paid against it.
  const reservation = await prisma.reservation.findUniqueOrThrow({
    where: { propertyId_reference: { propertyId: property.id, reference: "SEA-00001" } },
    include: { stays: true },
  });
  const stay = reservation.stays[0];

  const folio = await prisma.folio.upsert({
    where: { propertyId_number: { propertyId: property.id, number: "SEA-F-00001" } },
    update: {},
    create: {
      propertyId: property.id,
      reservationId: reservation.id,
      number: "SEA-F-00001",
      currencyCode: "EUR",
      createdById: owner.id,
      updatedById: owner.id,
      lines: {
        create: [
          {
            type: "ROOM",
            description: "Double Room — 14 Sep",
            roomStayId: stay?.id,
            serviceDate: day(0),
            unitPriceMinor: 12000,
            taxRateBp: 700,
            taxAmountMinor: 785,
            amountMinor: 12000,
            postedById: owner.id,
          },
          {
            type: "ROOM",
            description: "Double Room — 15 Sep",
            roomStayId: stay?.id,
            serviceDate: day(1),
            unitPriceMinor: 12000,
            taxRateBp: 700,
            taxAmountMinor: 785,
            amountMinor: 12000,
            postedById: owner.id,
          },
          {
            type: "CITY_TAX",
            description: "City tax — 2 nights × 2 guests",
            quantity: 4,
            unitPriceMinor: 200,
            amountMinor: 800,
            postedById: owner.id,
          },
        ],
      },
    },
  });

  await prisma.payment.upsert({
    where: { idempotencyKey: "seed-payment-1" },
    update: {},
    create: {
      propertyId: property.id,
      folioId: folio.id,
      reservationId: reservation.id,
      method: "CARD",
      status: "CAPTURED",
      amountMinor: 24800,
      currencyCode: "EUR",
      idempotencyKey: "seed-payment-1",
      capturedAt: new Date(),
      createdById: owner.id,
    },
  });

  // The ops chain: check-out leaves a room dirty and a task behind it.
  const [room101, room102] = await Promise.all([
    prisma.room.findUniqueOrThrow({
      where: { propertyId_number: { propertyId: property.id, number: "101" } },
    }),
    prisma.room.findUniqueOrThrow({
      where: { propertyId_number: { propertyId: property.id, number: "102" } },
    }),
  ]);
  const ownerMember = await prisma.organizationMember.findUniqueOrThrow({
    where: { organizationId_userId: { organizationId: organization.id, userId: owner.id } },
  });

  await prisma.housekeepingTask.upsert({
    where: { clientEventId: "seed-task-1" },
    update: {},
    create: {
      propertyId: property.id,
      roomId: room101.id,
      type: "DEPARTURE_CLEAN",
      dueDate: day(2),
      assignedMemberId: ownerMember.id,
      clientEventId: "seed-task-1",
      createdById: owner.id,
    },
  });

  // Assign the stay to a room, so the reservation grid has something to draw and
  // the overlap constraint is actually exercised by the demo data.
  await prisma.roomStay.updateMany({
    where: { reservationId: reservation.id },
    data: { roomId: room101.id },
  });

  // The demo organization switches its optional modules on; both are off by
  // default, so without this their routes 404 and the modules look broken
  // rather than off.
  for (const moduleId of ["DIRECTORY", "FRONT_DESK"]) {
    await prisma.organizationModule.upsert({
      where: { organizationId_moduleId: { organizationId: organization.id, moduleId } },
      update: {},
      create: { organizationId: organization.id, moduleId, enabled: true },
    });
  }

  // A corporate client, and the guest who books for them.
  const company = await prisma.company.upsert({
    where: { organizationId_taxId: { organizationId: organization.id, taxId: "DE123456789" } },
    update: {},
    create: {
      organization: { connect: { id: organization.id } },
      name: "Northwind Travel",
      legalName: "Northwind Travel GmbH",
      taxId: "DE123456789",
      email: "bookings@northwind.example",
      createdById: owner.id,
      updatedById: owner.id,
      address: { create: { line1: "9 Agency Street", city: "Hamburg", countryCode: "DE" } },
    },
  });

  await prisma.personCompany.upsert({
    where: { personId_companyId: { personId: guest.id, companyId: company.id } },
    update: {},
    create: {
      personId: guest.id,
      companyId: company.id,
      jobTitle: "Travel Manager",
      isPrimary: true,
    },
  });

  // The custom-field escape hatch, with one definition so the mechanism is
  // visible rather than theoretical.
  await prisma.customFieldDefinition.upsert({
    where: {
      organizationId_entityType_key: {
        organizationId: organization.id,
        entityType: "PERSON",
        key: "loyaltyTier",
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      entityType: "PERSON",
      key: "loyaltyTier",
      label: "Loyalty tier",
      fieldType: "SELECT",
      options: JSON.stringify(["bronze", "silver", "gold"]),
    },
  });

  // Restrictions: a two-night minimum on the first day, and the third closed to
  // arrival. Absent rows stay unrestricted, which is what makes the rest sell.
  await prisma.rateRestriction.upsert({
    where: {
      ratePlanId_roomTypeId_date: {
        ratePlanId: ratePlan.id,
        roomTypeId: roomType.id,
        date: day(0),
      },
    },
    update: {},
    create: {
      ratePlanId: ratePlan.id,
      roomTypeId: roomType.id,
      date: day(0),
      minLengthOfStay: 2,
    },
  });

  await prisma.rateRestriction.upsert({
    where: {
      ratePlanId_roomTypeId_date: {
        ratePlanId: ratePlan.id,
        roomTypeId: roomType.id,
        date: day(2),
      },
    },
    update: {},
    create: {
      ratePlanId: ratePlan.id,
      roomTypeId: roomType.id,
      date: day(2),
      closedToArrival: true,
    },
  });

  // Something broken on the floor, so housekeeping has both of its halves.
  if (!(await prisma.maintenanceIssue.findFirst({ where: { propertyId: property.id } }))) {
    await prisma.maintenanceIssue.create({
      data: {
        propertyId: property.id,
        roomId: room102.id,
        title: "Dripping tap in the bathroom",
        description: "Reported by the guest at check-out.",
        severity: "LOW",
        reportedByMemberId: ownerMember.id,
      },
    });
  }

  // An attachment with bytes actually behind it, and a storage key generated the
  // way the code must generate them: random, never derived from a row id.
  //
  // Written through the provider rather than to a path, so seeding onto S3 puts
  // it on S3. Both halves matter: a READY row with nothing behind it is exactly
  // the lie the two-phase flow exists to prevent.
  if (!(await prisma.attachment.findFirst({ where: { personId: guest.id } }))) {
    const storageKey = newStorageKey(`org/${organization.id}/attachments`, "marketing-consent.pdf");
    const store = await storage();
    const object = await store.put(storageKey, DEMO_PDF, { mimeType: "application/pdf" });

    await prisma.attachment.create({
      data: {
        organizationId: organization.id,
        personId: guest.id,
        kind: "CONSENT",
        fileName: "marketing-consent.pdf",
        storageKey,
        status: "READY",
        provider: store.name,
        providerId: object.providerId,
        mimeType: object.mimeType,
        sizeBytes: object.sizeBytes,
        uploadedAt: new Date(),
        signedAt: new Date(),
        uploadedById: owner.id,
      },
    });
  }

  // One audit row, so the trail is visibly append-only rather than an empty
  // table nobody trusts.
  if (!(await prisma.auditLog.findFirst({ where: { organizationId: organization.id } }))) {
    await prisma.auditLog.create({
      data: {
        organizationId: organization.id,
        actorUserId: owner.id,
        action: "CREATE",
        entityType: "Reservation",
        entityId: String(reservation.id),
        summary: `Created reservation ${reservation.reference}`,
      },
    });
  }

  console.log(
    created === 0
      ? `Nothing to do — all ${USERS.length} demo users already exist.`
      : `Created ${created} of ${USERS.length} demo users. Password: ${PASSWORD}`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
