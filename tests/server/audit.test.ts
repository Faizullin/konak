import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { callerFor, createFixture, prisma, type Fixture } from "./harness";
import { AuditAction } from "@/features/platform";
import { writeAudit } from "@/features/platform/server";
import { UserRole } from "@/features/identity";

/**
 * That the trail says what happened, and only what happened.
 *
 * `architecture.md` table convention 5 has required this table since it was
 * written and nothing wrote to it; these are the acts that now do.
 */

let fx: Fixture;

before(async () => {
  fx = await createFixture();
});

after(async () => {
  await fx.cleanup();
  /**
   * The fixture cannot do this. `AuditLog` deliberately has no foreign key to
   * `Organization` — the record of who deleted a tenant must outlive the
   * tenant — so deleting the organization no longer takes its rows with it, and
   * a test that did not sweep up would leave them behind on every run.
   */
  await prisma.auditLog.deleteMany({ where: { actorUserId: { contains: fx.tag } } });
  await prisma.$disconnect();
});

const trailFor = (entityId: string) =>
  prisma.auditLog.findMany({ where: { entityId }, orderBy: { id: "asc" } });

describe("what is recorded", () => {
  test("granting install-wide admin records who, from what, and from where", async () => {
    const admin = callerFor(fx.admin);
    await admin.user.updateRole({ id: fx.member.id, role: UserRole.ADMIN });

    const [entry, ...rest] = await trailFor(fx.member.id);
    assert.equal(rest.length, 0, "one act, one row");
    assert.equal(entry!.actorUserId, fx.admin.id, "who did it");
    assert.equal(entry!.action, AuditAction.UPDATE);
    assert.equal(entry!.entityType, "User");
    assert.equal(entry!.organizationId, null, "an install-wide act belongs to no tenant");

    // The diff is the allowlist's, not the row's.
    assert.deepEqual(JSON.parse(entry!.diffJson!), {
      role: { from: UserRole.USER, to: UserRole.ADMIN },
    });

    // Put it back, so the rest of the file sees the fixture it expects.
    await admin.user.updateRole({ id: fx.member.id, role: UserRole.USER });
  });

  test("adding a member is filed against the tenant it happened in", async () => {
    const owner = callerFor(fx.owner);
    await owner.organization.addMember({
      organizationId: fx.org.id,
      email: fx.admin.email,
      role: "MEMBER",
    });

    const [entry] = await trailFor(fx.admin.id);
    assert.equal(entry!.organizationId, fx.org.id);
    assert.equal(entry!.action, AuditAction.CREATE);
    assert.equal(entry!.entityType, "OrganizationMember");
  });
});

describe("the trail and the change are one act", () => {
  /**
   * The whole reason `writeAudit` takes the caller's transaction client rather
   * than opening its own. A mutation that rolls back must leave no trace of
   * having happened — otherwise the table that is meant to be the record of
   * what occurred accumulates records of what did not, and the first person to
   * read it during an incident is misled by it.
   *
   * Written against a real rollback rather than a mocked one, because the
   * claim is about the database, not about the function.
   */
  test("a mutation that rolls back leaves no trail", async () => {
    const entityId = `rollback-${fx.tag}`;

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          organizationId: fx.org.id,
          actorUserId: fx.owner.id,
          action: AuditAction.UPDATE,
          entityType: "Organization",
          entityId,
          summary: "A change that does not survive",
          before: { name: "Before" },
          after: { name: "After" },
        });
        throw new Error("the mutation failed after filing");
      }),
      /failed after filing/
    );

    assert.deepEqual(await trailFor(entityId), [], "nothing was kept");
  });

  /**
   * The mirror of the above, and the migration that made it true: the row
   * recording a deletion used to be the deletion's first casualty, because the
   * foreign key cascaded. Deleting a tenant is exactly the act somebody will
   * come looking for afterwards.
   */
  test("deleting a tenant does not delete the record of who deleted it", async () => {
    const doomed = await prisma.organization.create({
      data: { name: `Doomed ${fx.tag}`, slug: `doomed-${fx.tag}`, ownerId: fx.owner.id },
    });
    await prisma.organizationMember.create({
      data: { organizationId: doomed.id, userId: fx.owner.id, role: "OWNER" },
    });

    await callerFor(fx.owner).organization.delete({ id: doomed.id });

    assert.equal(await prisma.organization.findUnique({ where: { id: doomed.id } }), null);

    const [entry] = await trailFor(String(doomed.id));
    assert.ok(entry, "the trail outlived the tenant");
    assert.equal(entry!.action, AuditAction.DELETE);
    assert.equal(entry!.actorUserId, fx.owner.id);
    assert.equal(
      entry!.organizationId,
      doomed.id,
      "still says which tenant, with no row to point at"
    );
  });
});
