import "dotenv/config";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { appRouter } from "@/server/root";
import { DomainError } from "@/server/errors";
import prisma from "@/server/db";
import { createCallerFactory } from "@/server/trpc";
import { OrgRole } from "@/features/organizations";
import { UserRole } from "@/features/identity";

/**
 * Integration harness: real Prisma, real router, fabricated session.
 *
 * These tests exist for what `model/` cannot answer — that a procedure actually
 * asks the question it should, against a real database. Everything provable
 * with pure functions belongs in `model/` instead, where it needs no service.
 */

const createCaller = createCallerFactory(appRouter);

export type TestUser = { id: string; email: string; name: string; role: string };

/**
 * The stable half of a refusal, for a test that should not assert on prose.
 *
 * A refusal has two shapes depending on where it is caught. Through a procedure
 * it is a `TRPCError` with the `DomainError` as its `cause` — the boundary
 * middleware did that, and over HTTP the same value arrives as
 * `data.domainCode`. Called directly, a service throws the `DomainError`
 * itself, because the domain does not know about tRPC.
 *
 * This reads the code from either, so a test asserts on the rule rather than on
 * which side of the boundary it happened to catch it.
 */
export function domainCodeOf(error: unknown): string | null {
  if (error instanceof DomainError) return error.code;
  const cause = error instanceof TRPCError ? error.cause : null;
  return cause instanceof DomainError ? cause.code : null;
}

/**
 * A session as `protectedProcedure` sees it. Better Auth's own type carries
 * fields no procedure reads, so this is narrowed on purpose rather than faked
 * wholesale — if a procedure starts reading one, the cast is where it breaks.
 */
export function callerFor(user: TestUser | null) {
  const session = user
    ? {
        user,
        session: { id: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
      }
    : null;

  return createCaller({ db: prisma, session } as Parameters<typeof createCaller>[0]);
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

/**
 * One organization with an owner, a plain member, and an outsider who belongs
 * to a second organization. Everything is suffixed so parallel runs and repeat
 * runs never collide.
 */
export async function createFixture() {
  const tag = randomUUID().slice(0, 8);

  const mkUser = (label: string, role: string = UserRole.USER) =>
    prisma.user.create({
      data: {
        id: `test-${label}-${tag}`,
        name: `${label} ${tag}`,
        email: `${label}-${tag}@example.test`,
        role,
      },
    });

  const [owner, member, outsider, admin] = await Promise.all([
    mkUser("owner"),
    mkUser("member"),
    mkUser("outsider"),
    mkUser("admin", UserRole.ADMIN),
  ]);

  const org = await prisma.organization.create({
    data: {
      name: `Org ${tag}`,
      slug: `org-${tag}`,
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: OrgRole.OWNER },
          { userId: member.id, role: OrgRole.MEMBER },
        ],
      },
    },
  });

  const otherOrg = await prisma.organization.create({
    data: {
      name: `Other ${tag}`,
      slug: `other-${tag}`,
      ownerId: outsider.id,
      members: { create: [{ userId: outsider.id, role: OrgRole.OWNER }] },
    },
  });

  // DIRECTORY is off by default, so an organization that uses it says so. This
  // is the fixture doing what a real tenant does, not a workaround.
  await prisma.organizationModule.createMany({
    data: [org.id, otherOrg.id].map((organizationId) => ({
      organizationId,
      moduleId: "DIRECTORY",
      enabled: true,
    })),
  });

  // A second tenant, so "cannot read another organization" is a real assertion
  // rather than a query against an empty table.
  return {
    tag,
    org,
    otherOrg,
    owner,
    member,
    outsider,
    admin,
    async cleanup() {
      await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
      await prisma.user.deleteMany({
        where: { id: { in: [owner.id, member.id, outsider.id, admin.id] } },
      });
    },
  };
}

export { prisma };
