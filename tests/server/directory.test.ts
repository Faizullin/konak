import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { callerFor, createFixture, domainCodeOf, prisma, type Fixture } from "./harness";
import { OrganizationError } from "@/features/organizations";

/**
 * What `model/` cannot answer: that the procedures actually ask the questions
 * their permission table defines, against a real database.
 */

let fx: Fixture;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await fx.cleanup();
  await prisma.$disconnect();
});

const code = (error: unknown) => (error instanceof TRPCError ? error.code : String(error));
const field = (error: unknown) =>
  error instanceof TRPCError && error.cause && "field" in error.cause
    ? (error.cause as { field: string }).field
    : null;

describe("tenant isolation", () => {
  test("a member of one organization cannot read another's directory", async () => {
    // The most dangerous bug class in a multi-tenant system: not a crash, a
    // silent read of someone else's guests.
    const outsider = callerFor(fx.outsider);
    await assert.rejects(
      () => outsider.directory.listPeople({ organizationId: fx.org.id, pagination: {} }),
      (e) => code(e) === "FORBIDDEN"
    );
  });

  test("a person is invisible from the wrong organization, not merely refused", async () => {
    const owner = callerFor(fx.owner);
    const person = await owner.directory.createPerson({
      organizationId: fx.org.id,
      firstName: "Ada",
      lastName: "Lovelace",
    });

    // Reading it through the other org must not distinguish "not yours" from
    // "does not exist" — the id is scoped into the lookup, not checked after it.
    const outsider = callerFor(fx.outsider);
    await assert.rejects(
      () => outsider.directory.getPerson({ organizationId: fx.otherOrg.id, id: person.id }),
      (e) => code(e) === "NOT_FOUND"
    );
  });

  test("an anonymous caller reaches nothing", async () => {
    await assert.rejects(
      () => callerFor(null).directory.listPeople({ organizationId: fx.org.id, pagination: {} }),
      (e) => code(e) === "UNAUTHORIZED"
    );
  });
});

describe("permissions", () => {
  test("a member keeps the guest book but cannot archive it", async () => {
    const member = callerFor(fx.member);

    const person = await member.directory.createPerson({
      organizationId: fx.org.id,
      firstName: "Grace",
      lastName: "Hopper",
    });
    assert.ok(person.id);

    await member.directory.updatePerson({
      organizationId: fx.org.id,
      id: person.id,
      firstName: "Grace B.",
    });

    // Archiving is a manager's call. The UI hides the button; this is the
    // enforcement.
    await assert.rejects(
      () =>
        member.directory.archivePerson({
          organizationId: fx.org.id,
          id: person.id,
          archived: true,
        }),
      (e) => code(e) === "FORBIDDEN"
    );
  });

  test("a member may not create companies; an owner may", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.member).directory.createCompany({
          organizationId: fx.org.id,
          name: "Acme Travel",
        }),
      (e) => code(e) === "FORBIDDEN"
    );

    const company = await callerFor(fx.owner).directory.createCompany({
      organizationId: fx.org.id,
      name: "Acme Travel",
    });
    assert.equal(company.name, "Acme Travel");
  });
});

describe("important actions", () => {
  test("a duplicate email is refused, and says which field", async () => {
    const owner = callerFor(fx.owner);
    await owner.directory.createPerson({
      organizationId: fx.org.id,
      firstName: "Alan",
      lastName: "Turing",
      email: "alan@example.test",
    });

    await assert.rejects(
      () =>
        owner.directory.createPerson({
          organizationId: fx.org.id,
          firstName: "Alan",
          lastName: "Turing",
          email: "ALAN@example.test",
        }),
      (e) => code(e) === "CONFLICT" && field(e) === "email"
    );
  });

  test("the same email is free in another organization", async () => {
    // Uniqueness is per tenant. Two hotels may both know alan@example.test.
    const other = await callerFor(fx.outsider).directory.createPerson({
      organizationId: fx.otherOrg.id,
      firstName: "Alan",
      lastName: "Turing",
      email: "alan@example.test",
    });
    assert.equal(other.email, "alan@example.test");
  });

  test("a link cannot join a person to another tenant's company", async () => {
    const owner = callerFor(fx.owner);
    const person = await owner.directory.createPerson({
      organizationId: fx.org.id,
      firstName: "Katherine",
      lastName: "Johnson",
    });
    const foreign = await callerFor(fx.outsider).directory.createCompany({
      organizationId: fx.otherOrg.id,
      name: "Foreign Ltd",
    });

    await assert.rejects(
      () =>
        owner.directory.linkPerson({
          organizationId: fx.org.id,
          personId: person.id,
          companyId: foreign.id,
        }),
      (e) => code(e) === "NOT_FOUND"
    );
  });

  test("archived people leave the default list", async () => {
    const owner = callerFor(fx.owner);
    const person = await owner.directory.createPerson({
      organizationId: fx.org.id,
      firstName: "Archived",
      lastName: "Person",
    });

    const before = await owner.directory.listPeople({
      organizationId: fx.org.id,
      pagination: { take: 100 },
    });
    await owner.directory.archivePerson({
      organizationId: fx.org.id,
      id: person.id,
      archived: true,
    });
    const after = await owner.directory.listPeople({
      organizationId: fx.org.id,
      pagination: { take: 100 },
    });

    assert.equal(after.total, before.total - 1);
    assert.ok(!after.items.some((p) => p.id === person.id));
  });
});

describe("module enablement", () => {
  test("a disabled module is refused by the procedure, not merely hidden", async () => {
    const { requireOrgModule } = await import("@/features/organizations/server");
    const where = {
      organizationId_moduleId: { organizationId: fx.org.id, moduleId: "DIRECTORY" },
    };

    // The fixture switched it on, the way a tenant would.
    await requireOrgModule(fx.org.id, "DIRECTORY");
    await callerFor(fx.owner).directory.listPeople({
      organizationId: fx.org.id,
      pagination: {},
    });

    await prisma.organizationModule.update({ where, data: { enabled: false } });
    try {
      // Not merely hidden: the procedure itself refuses.
      // Called directly, the service throws its `DomainError` — the boundary
      // that would make it a `TRPCError` is a procedure, and there is none here.
      await assert.rejects(
        () => requireOrgModule(fx.org.id, "DIRECTORY"),
        (e) => domainCodeOf(e) === OrganizationError.MODULE_DISABLED
      );
      await assert.rejects(
        () =>
          callerFor(fx.owner).directory.listPeople({
            organizationId: fx.org.id,
            pagination: {},
          }),
        (e) => code(e) === "FORBIDDEN"
      );
    } finally {
      await prisma.organizationModule.update({ where, data: { enabled: true } });
    }
  });

  test("a disabled module refuses writes, not only reads", async () => {
    // The first version of this guard was on the list procedure alone, which
    // would have left a switched-off module writable.
    const where = {
      organizationId_moduleId: { organizationId: fx.org.id, moduleId: "DIRECTORY" },
    };
    await prisma.organizationModule.update({ where, data: { enabled: false } });
    try {
      await assert.rejects(
        () =>
          callerFor(fx.owner).directory.createPerson({
            organizationId: fx.org.id,
            firstName: "Should",
            lastName: "Refuse",
          }),
        (e) => code(e) === "FORBIDDEN"
      );
    } finally {
      await prisma.organizationModule.update({ where, data: { enabled: true } });
    }
  });

  test("a module with no row at all follows its default", async () => {
    // A tenant that never said anything about the module: DIRECTORY is off by
    // default, so absence of a row is a refusal, not a permission.
    const { requireOrgModule } = await import("@/features/organizations/server");
    const bare = await prisma.organization.create({
      data: { name: `Bare ${fx.tag}`, slug: `bare-${fx.tag}`, ownerId: fx.owner.id },
    });
    try {
      await assert.rejects(
        () => requireOrgModule(bare.id, "DIRECTORY"),
        (e) => domainCodeOf(e) === OrganizationError.MODULE_DISABLED
      );
    } finally {
      await prisma.organization.delete({ where: { id: bare.id } });
    }
  });

  test("a non-member is refused before the module is consulted", async () => {
    // Otherwise an outsider probing another tenant learns which modules it
    // runs — configuration disclosed to someone with no membership at all.
    await assert.rejects(
      () =>
        callerFor(fx.outsider).directory.listPeople({
          organizationId: fx.org.id,
          pagination: {},
        }),
      (e) => code(e) === "FORBIDDEN" && !String((e as Error).message).includes("not enabled")
    );
  });

  test("a core module cannot be switched off by a stray row", async () => {
    const { requireOrgModule } = await import("@/features/organizations/server");
    await prisma.organizationModule.create({
      data: { organizationId: fx.org.id, moduleId: "SETTINGS", enabled: false },
    });
    await requireOrgModule(fx.org.id, "SETTINGS");
  });

  test("moduleAccess reports the caller's role and the organization's toggles", async () => {
    const access = await callerFor(fx.member).organization.moduleAccess({ slug: fx.org.slug });
    assert.equal(access.role, "MEMBER");
    assert.ok(access.toggles.some((t) => t.moduleId === "DIRECTORY"));
  });

  test("moduleAccess refuses a non-member", async () => {
    await assert.rejects(
      () => callerFor(fx.outsider).organization.moduleAccess({ slug: fx.org.slug }),
      (e) => code(e) === "FORBIDDEN"
    );
  });
});

describe("stay history", () => {
  test("a person's stays are the ones they booked and the ones they slept in", async () => {
    // The person who books is often not the person who sleeps — a company for a
    // colleague, a parent for a child — so a history reading only the booker
    // would lose half of them.
    const caller = callerFor(fx.owner);

    const booker = await prisma.person.create({
      data: { organizationId: fx.org.id, firstName: "Booked", lastName: `By ${fx.tag}` },
    });
    const sleeper = await prisma.person.create({
      data: { organizationId: fx.org.id, firstName: "Slept", lastName: `In ${fx.tag}` },
    });

    const property = await prisma.property.create({
      data: {
        organizationId: fx.org.id,
        name: `Stays ${fx.tag}`,
        slug: `stays-${fx.tag}`,
        currencyCode: "EUR",
        roomTypes: { create: { name: "Twin", code: "TWN", maxOccupancy: 2 } },
      },
      include: { roomTypes: true },
    });

    const reservation = await prisma.reservation.create({
      data: {
        propertyId: property.id,
        reference: `HIST-${fx.tag}`,
        status: "CONFIRMED",
        currencyCode: "EUR",
        totalMinor: 15000,
        bookerPersonId: booker.id,
        guests: { create: [{ personId: sleeper.id, isPrimary: true }] },
        stays: {
          create: [
            {
              propertyId: property.id,
              roomTypeId: property.roomTypes[0]!.id,
              status: "CONFIRMED",
              checkIn: new Date(Date.UTC(2027, 4, 1)),
              checkOut: new Date(Date.UTC(2027, 4, 4)),
              currencyCode: "EUR",
            },
          ],
        },
      },
    });

    for (const personId of [booker.id, sleeper.id]) {
      const history = await caller.directory.stayHistory({
        organizationId: fx.org.id,
        personId,
      });
      assert.equal(history.length, 1);
      assert.equal(history[0]?.reference, `HIST-${fx.tag}`);
      assert.equal(history[0]?.nights, 3);
    }

    await prisma.reservation.deleteMany({ where: { id: reservation.id } });
    await prisma.roomType.deleteMany({ where: { propertyId: property.id } });
    await prisma.property.deleteMany({ where: { id: property.id } });
    await prisma.person.deleteMany({ where: { id: { in: [booker.id, sleeper.id] } } });
  });

  test("another tenant's stays are not this person's history", async () => {
    const other = await createFixture();
    try {
      await assert.rejects(
        callerFor(other.owner).directory.stayHistory({
          organizationId: fx.org.id,
          personId: 1,
        })
      );
    } finally {
      await other.cleanup();
    }
  });
});

describe("search", () => {
  /**
   * The bug this pins was invisible and total: Prisma's bare `contains` is
   * `LIKE` on Postgres, so the directory answered nothing at all unless the
   * receptionist capitalised a surname exactly as it was stored. Nobody types a
   * surname capitalised, and the two searches written later — properties,
   * bookings — had `mode` while these did not.
   */
  test("a name is found however it is typed", async () => {
    const owner = callerFor(fx.owner);
    await owner.directory.createPerson({
      organizationId: fx.org.id,
      firstName: "Мария",
      // Unique to this test: the fixture's org is shared across the file.
      lastName: "Иванова-Найдёнова",
      email: "Maria.Ivanova@Example.COM",
    });

    const find = async (search: string) =>
      (
        await owner.directory.listPeople({
          organizationId: fx.org.id,
          filter: { search },
          pagination: { take: 100 },
        })
      ).items;

    // Cyrillic, all three ways somebody might type it.
    assert.equal((await find("иванова-найдёнова")).length, 1, "lower case");
    assert.equal((await find("ИВАНОВА-НАЙДЁНОВА")).length, 1, "upper case");
    assert.equal((await find("Иванова-Найдёнова")).length, 1, "as stored");
    // And the Latin path, which is what a stored-address search hits.
    assert.equal((await find("maria.ivanova@example.com")).length, 1, "an email typed flat");
  });

  test("a company is found however it is typed", async () => {
    const owner = callerFor(fx.owner);
    await owner.directory.createCompany({
      organizationId: fx.org.id,
      name: "ТОО Жолсерік",
    });

    const find = async (search: string) =>
      (
        await owner.directory.listCompanies({
          organizationId: fx.org.id,
          filter: { search },
          pagination: { take: 100 },
        })
      ).items;

    assert.equal((await find("жолсерік")).length, 1, "lower case");
    assert.equal((await find("ЖОЛСЕРІК")).length, 1, "upper case");
  });

  /**
   * `ё` is optional in Russian orthography — passport offices and airlines print
   * `е` for it routinely, so Фёдоров and Федоров are one person with two
   * spellings. Search normalisation generates variants for both and splits on whitespace.
   */
  test("ё and е are normalised and multi-term search matches across names", async () => {
    const owner = callerFor(fx.owner);
    await owner.directory.createPerson({
      organizationId: fx.org.id,
      firstName: "Пётр",
      lastName: "Фёдоров-Ёлкин",
    });

    const find = async (search: string) =>
      (
        await owner.directory.listPeople({
          organizationId: fx.org.id,
          filter: { search },
          pagination: { take: 100 },
        })
      ).items;

    assert.equal((await find("фёдоров-ёлкин")).length, 1, "spelled with ё, as stored");
    assert.equal((await find("федоров-елкин")).length, 1, "spelled with е");
    assert.equal((await find("Пётр Фёдоров")).length, 1, "multi-term across names");
    assert.equal((await find("Петр Федоров")).length, 1, "multi-term with е instead of ё");
  });
});
