import { z } from "zod";

/**
 * Custom fields live in a `String` column because SQLite has no Json type.
 * Everything here is the boundary between that string and a usable object.
 */

export const customFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export type CustomFieldValue = z.infer<typeof customFieldValueSchema>;

export const customFieldsSchema = z.record(z.string(), customFieldValueSchema);

export type CustomFields = z.infer<typeof customFieldsSchema>;

/**
 * Never throws. The column can hold anything a migration or a hand-edited row
 * put there, and a profile page must not 500 because one is malformed.
 */
export function parseCustomFields(raw: string | null | undefined): CustomFields {
  if (!raw) return {};
  try {
    const parsed = customFieldsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** `null` for an empty object, so the column stays empty rather than holding `"{}"`. */
export function serializeCustomFields(fields: CustomFields | undefined): string | null {
  if (!fields || Object.keys(fields).length === 0) return null;
  return JSON.stringify(fields);
}
