import "server-only";
import { cache } from "react";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import prisma from "@/server/db";
import {
  ORGANIZATION_ROUTE_SELECT,
  OrganizationError,
  OrgRole,
  isOrgModuleEnabled,
  orgModule,
  type OrgModuleId,
  type OrganizationRouteData,
} from "../model";

type OrgDb = Pick<typeof prisma, "organization" | "organizationMember">;

/** A slug must be unique across the install — it appears in URLs. */
export async function assertSlugAvailable(
  db: OrgDb,
  slug: string,
  excludeId?: number
): Promise<void> {
  const existing = await db.organization.findUnique({ where: { slug } });
  if (existing && existing.id !== excludeId) {
    throw new ConflictError(OrganizationError.SLUG_TAKEN, "That slug is already taken", "slug");
  }
}

/**
 * Create an organization together with its owner membership. The two are one
 * unit: an organization whose creator is not a member is unreachable — it
 * would not appear in anyone's `list`, and every guard would refuse it.
 */
export async function createOrganizationWithOwner(
  db: OrgDb,
  input: { name: string; slug: string; description?: string; ownerId: string }
) {
  await assertSlugAvailable(db, input.slug);

  return db.organization.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description,
      ownerId: input.ownerId,
      members: {
        create: { userId: input.ownerId, role: OrgRole.OWNER },
      },
    },
    include: { members: true },
  });
}

/**
 * Move ownership to another member, demoting the previous owner to ADMIN.
 *
 * Both writes in one transaction: an organization with two owners and one
 * with none are equally broken, and either is what a half-applied change
 * leaves behind.
 */
export async function transferOwnership(
  db: typeof prisma,
  organizationId: number,
  fromUserId: string,
  toUserId: string
) {
  const target = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: toUserId } },
  });
  if (!target) {
    throw new NotFoundError(
      OrganizationError.MEMBER_NOT_FOUND,
      "That person is not a member of this organization"
    );
  }

  return db.$transaction([
    db.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId: toUserId } },
      data: { role: OrgRole.OWNER },
    }),
    db.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId: fromUserId } },
      data: { role: OrgRole.ADMIN },
    }),
    db.organization.update({
      where: { id: organizationId },
      data: { ownerId: toUserId },
    }),
  ]);
}

/**
 * Routes carry the slug, procedures take the id; this is where the two meet.
 * Membership is not checked here — the procedures each page calls do it.
 *
 * `cache()` because a single navigation asks three times: `generateMetadata`,
 * the layout, and the page. It is per-request, so it dedupes without ever
 * serving one visitor's organization to another.
 */
export const organizationBySlug = cache(
  async (slug: string): Promise<OrganizationRouteData | null> =>
    prisma.organization.findUnique({
      where: { slug },
      select: ORGANIZATION_ROUTE_SELECT,
    })
);

/**
 * Refuses when an organization has this module switched off.
 *
 * The nav hides a disabled module and the route 404s it, but **this is the
 * enforcement** — both of those are courtesies, exactly as with roles. A caller
 * reaching tRPC directly gets the same answer.
 */
export async function requireOrgModule(organizationId: number, moduleId: OrgModuleId) {
  const toggles = await prisma.organizationModule.findMany({
    where: { organizationId },
    select: { moduleId: true, enabled: true },
  });

  if (!isOrgModuleEnabled(moduleId, toggles)) {
    throw new ForbiddenError(
      OrganizationError.MODULE_DISABLED,
      `${orgModule(moduleId).label} is not enabled for this organization`
    ).with({ module: orgModule(moduleId).label });
  }
}
