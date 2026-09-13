import "server-only";
import { NotFoundError } from "@/server/errors";
import { requireOrgMember, type AuthedContext } from "@/server/auth";
import { PropertyError } from "../model";

/**
 * Properties — the guard every property-scoped procedure starts with.
 *
 * `Organization` is the tenant and `Property` is one hotel, so a property id is
 * only meaningful once it has been resolved to the organization that owns it.
 * Doing that resolution here is what stops each router inventing its own
 * version: `reservations` and `rates` had a copy each, which is the third
 * caller `server/errors.ts` sets as the threshold for a shared name.
 *
 * The two refusals are different on purpose. An id that names no row is
 * NOT_FOUND; one that names another tenant's hotel is FORBIDDEN, because that
 * is the honest answer to "you are signed in, and this is not yours" — the same
 * distinction `requireOrgMember` draws.
 */
export async function requirePropertyMember(ctx: AuthedContext, propertyId: number) {
  /**
   * Wide enough that nobody re-reads it.
   *
   * It used to select `{ id, organizationId }`, and five procedures then
   * fetched the same row again for a `timezone` or a `currencyCode` — the very
   * thing `roadmap.md`'s end-of-phase gate asks about ("does any request do the
   * same lookup twice?"). The row is tiny and every caller is already paying
   * for the round trip.
   */
  const property = await ctx.db.property.findUnique({
    where: { id: propertyId },
    select: {
      id: true,
      organizationId: true,
      slug: true,
      name: true,
      timezone: true,
      currencyCode: true,
    },
  });
  if (!property) {
    throw new NotFoundError(PropertyError.NOT_FOUND, "Property not found");
  }

  const member = await requireOrgMember(ctx, property.organizationId);
  return { property, ...member };
}
