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
  .min(2, "Slug must be at least 2 characters")
  .max(48, "Slug must be at most 48 characters")
  .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens");

export const listPropertiesSchema = z.object({
  organizationId: z.number(),
  search: z.string().optional(),
  includeArchived: z.boolean().optional(),
});

export type ListPropertiesInput = z.infer<typeof listPropertiesSchema>;

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
