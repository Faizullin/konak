import { one, query } from "../lib/db";

/**
 * The hotel the seed made, and the ids a test needs to reach its screens.
 *
 * Read rather than created. The demo property is what `npm run db:seed` writes
 * and what the screenshot report photographs, so a journey against a fabricated
 * one would prove something about a hotel nobody ever sees.
 *
 * Anything a test *changes* is its own to create and remove — `booking.ts`.
 */

export type SeededProperty = {
  organizationSlug: string;
  propertySlug: string;
  propertyId: number;
  organizationId: number;
  timezone: string;
  roomTypeId: number;
  roomIds: number[];
  /** The path every front-desk screen hangs off. */
  deskPath: string;
};

export async function seededProperty(): Promise<SeededProperty> {
  const property = await one<{
    id: number;
    slug: string;
    organizationId: number;
    timezone: string;
    orgSlug: string;
  }>(
    `select p.id, p.slug, p."organizationId", p.timezone, o.slug as "orgSlug"
       from properties p
       join organizations o on o.id = p."organizationId"
      where p.slug = $1 and p."archivedAt" is null
      limit 1`,
    ["seaside"]
  );

  const roomTypes = await query<{ id: number }>(
    `select id from room_types where "propertyId" = $1 and "archivedAt" is null order by position, id`,
    [property.id]
  );
  const rooms = await query<{ id: number }>(
    `select id from rooms where "propertyId" = $1 and "archivedAt" is null order by id`,
    [property.id]
  );

  return {
    organizationSlug: property.orgSlug,
    propertySlug: property.slug,
    propertyId: property.id,
    organizationId: property.organizationId,
    timezone: property.timezone,
    roomTypeId: roomTypes[0]!.id,
    roomIds: rooms.map((room) => room.id),
    deskPath: `/dashboard/orgs/${property.orgSlug}/front-desk/${property.slug}`,
  };
}
