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
  /** The path every front-desk screen hangs off, on the **dashboard**. */
  deskPath: string;
  /**
   * The same property on the **desk** surface.
   *
   * Two paths rather than one because the two are different shells around the
   * same procedures, and the bugs that live between them are bugs of the shell:
   * a link that leaves it, a layout that 500s. Specs that assert the *product*
   * keep using `deskPath`; `desk.e2e.ts` asserts the *surface* and uses this.
   */
  surfacePath: string;
  /** A booking to open — the one with a bill behind it, so the report's Оплата
      tab photographs lines and a payment rather than an empty panel. */
  bookingPublicId: string;
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

  // Preferring one that already has a folio: `order by` puts the billed ones
  // first and falls back to any booking, so this never returns nothing on a
  // database where nobody has checked out.
  const booking = await one<{ publicId: string }>(
    `select r."publicId"
       from reservations r
       left join folios f on f."reservationId" = r.id
      where r."propertyId" = $1
      order by (f.id is null), r.id
      limit 1`,
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
    surfacePath: `/desk/${property.orgSlug}/${property.slug}`,
    bookingPublicId: booking.publicId,
  };
}
