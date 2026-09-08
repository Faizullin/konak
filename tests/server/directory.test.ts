import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { callerFor, createFixture, prisma, type Fixture } from "./harness";

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
