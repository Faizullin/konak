import { z } from "zod";

/**
 * Rules shared by both halves of the directory. A person and a company differ
 * in their fields, not in how they are scoped, deduplicated or archived.
 */

/**
 * Lowercased and trimmed before it reaches the database. The unique index is
 * `(organizationId, email)`, and without this `Ada@x.com` and `ada@x.com`
 * become two guests.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/** Empty strings from a form become `null`, so "unset" has one representation. */
export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const emailField = z.email("email_invalid").optional().or(z.literal(""));

export const addressSchema = z.object({
  line1: z.string().min(1, "address_line1_required").max(200),
  line2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postalCode: z.string().max(32).optional(),
  countryCode: z
    .string()
    .length(2, "country_code")
    .regex(/^[A-Z]{2}$/, "country_code_upper"),
});

export type AddressInput = z.infer<typeof addressSchema>;

/** The list contract every table view speaks. */
export const paginationSchema = z.object({
  skip: z.number().min(0).default(0),
  take: z.number().min(1).max(100).default(10),
});
