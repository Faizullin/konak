import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { UserRole } from "@/features/identity";
import { callerFor, createFixture, prisma, type Fixture } from "./harness";

let fx: Fixture;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await fx.cleanup();
  await prisma.$disconnect();
});

const code = (error: unknown) => (error instanceof TRPCError ? error.code : String(error));

describe("install-wide permissions", () => {
  test("an ordinary user cannot list the install's accounts", async () => {
    await assert.rejects(
      () => callerFor(fx.member).user.adminList({ pagination: {} }),
      (e) => code(e) === "FORBIDDEN"
    );
  });

  test("an admin can", async () => {
    const result = await callerFor(fx.admin).user.adminList({ pagination: {} });
    assert.ok(result.total >= 1);
  });

  test("an ordinary user cannot change anyone's role", async () => {
    await assert.rejects(
      () => callerFor(fx.member).user.updateRole({ id: fx.owner.id, role: UserRole.ADMIN }),
      (e) => code(e) === "FORBIDDEN"
    );
  });
});

describe("the lockout guard", () => {
  test("an admin may be demoted while another admin remains", async () => {
    // Two admins exist: the fixture's, and whoever else the install has. Make a
    // second explicitly so the test does not depend on the seed.
    const second = await prisma.user.create({
      data: {
        id: `test-admin2-${fx.tag}`,
        name: `Admin2 ${fx.tag}`,
        email: `admin2-${fx.tag}@example.test`,
        role: UserRole.ADMIN,
      },
    });

    const updated = await callerFor(fx.admin).user.updateRole({
      id: second.id,
      role: UserRole.USER,
    });
    assert.equal(updated.role, UserRole.USER);

    await prisma.user.delete({ where: { id: second.id } });
  });

  test("the last admin cannot be demoted", async () => {
    // `adminProcedure` is the only route to this procedure, and demotion is
    // what removes it — there is no way back from inside the app.
    const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
    const others = admins.filter((a) => a.id !== fx.admin.id);

    // Park every other admin so the fixture's admin is genuinely the last one.
    await prisma.user.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { role: UserRole.USER },
    });

    try {
      await assert.rejects(
        () => callerFor(fx.admin).user.updateRole({ id: fx.admin.id, role: UserRole.USER }),
        (e) => code(e) === "BAD_REQUEST"
      );
    } finally {
      for (const admin of others) {
        await prisma.user.update({ where: { id: admin.id }, data: { role: admin.role } });
      }
    }
  });

  test("a missing user is a 404, not a Prisma error", async () => {
    await assert.rejects(
      () => callerFor(fx.admin).user.updateRole({ id: "no-such-user", role: UserRole.ADMIN }),
      (e) => code(e) === "NOT_FOUND"
    );
  });
});
