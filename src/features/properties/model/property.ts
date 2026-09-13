import { z } from "zod";

/**
 * A property is one hotel. `Organization` is the tenant that pays for the
 * software and may own several, so a property is scoped by `organizationId`
 * and everything beneath it carries `propertyId`.
 *
 * Slugs are unique per organization, not per install: two management companies
 * may each have a "riverside".
 */

/** Lowercase letters, digits and hyphens — it appears in URLs. */
export const propertySlugSchema = z
  .string()
  .min(2, "slug_too_short")
  .max(48, "slug_too_long")
  .regex(/^[a-z0-9-]+$/, "slug_format");

export const listPropertiesSchema = z.object({
  organizationId: z.number(),
  search: z.string().optional(),
  includeArchived: z.boolean().optional(),
});

export type ListPropertiesInput = z.infer<typeof listPropertiesSchema>;

/**
 * A new hotel.
 *
 * The timezone is not cosmetic and is not defaulted away: a hotel's day ends at
 * its front desk, and "has this booking arrived yet" is answered against the
 * property's own day or answered wrongly twice a day. The currency is the same
 * kind of decision — every price beneath it is denominated in it.
 */
export const createPropertySchema = z.object({
  organizationId: z.number(),
  name: z.string().min(1, "name_required").max(120),
  slug: propertySlugSchema,
  timezone: z.string().min(1, "name_required").max(64),
  currencyCode: z
    .string()
    .length(3, "currency_code")
    .regex(/^[A-Z]{3}$/, "currency_code"),
  /** Minutes from midnight, property-local. 14:00 is 840. */
  checkInMinutes: z.number().int().min(0).max(1439).default(840),
  checkOutMinutes: z.number().int().min(0).max(1439).default(660),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

/** The dialog's half: the organization comes from the route. */
export const propertyFormSchema = createPropertySchema.omit({ organizationId: true }).extend({
  checkInMinutes: z.number().int().min(0).max(1439),
  checkOutMinutes: z.number().int().min(0).max(1439),
});

export type PropertyFormInput = z.infer<typeof propertyFormSchema>;

export const propertyBySlugSchema = z.object({
  organizationId: z.number(),
  slug: propertySlugSchema,
});

/** What a route resolves from a slug: enough for a heading and `generateMetadata`. */
export type PropertyRouteData = {
  id: number;
  name: string;
  slug: string;
  timezone: string;
  currencyCode: string;
};

/** The Prisma `select` that produces it. Kept beside the type so they cannot drift. */
export const PROPERTY_ROUTE_SELECT = {
  id: true,
  name: true,
  slug: true,
  timezone: true,
  currencyCode: true,
} as const;

/**
 * Minutes past midnight, property-local, as `HH:MM`. The columns are minutes
 * because arithmetic on them is what a stay's nights need; this is the half a
 * person reads.
 */
export function formatDayMinutes(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}
