import { z } from "zod";
import { addressSchema, emailField, paginationSchema } from "./party";

export const PERSON_SORT_FIELDS = ["lastName", "firstName", "createdAt"] as const;

export const createPersonSchema = z.object({
  organizationId: z.number(),
  firstName: z.string().min(1, "First name is required").max(80),
  lastName: z.string().min(1, "Last name is required").max(80),
  email: emailField,
  phone: z.string().max(40).optional(),
  dateOfBirth: z.date().optional(),
  notes: z.string().max(2000).optional(),
  address: addressSchema.optional(),
});

export type CreatePersonInput = z.infer<typeof createPersonSchema>;

/** The form's half: the organization comes from the route, not a field. */
export const personFormSchema = createPersonSchema.omit({ organizationId: true });

export type PersonFormInput = z.infer<typeof personFormSchema>;

export const updatePersonSchema = personFormSchema.partial().extend({ id: z.number() });

export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;

export const listPeopleSchema = z.object({
  organizationId: z.number(),
  filter: z
    .object({
      search: z.string().optional(),
      companyId: z.number().optional(),
      includeArchived: z.boolean().optional(),
    })
    .optional(),
  orderBy: z
    .object({
      field: z.enum(PERSON_SORT_FIELDS),
      direction: z.enum(["asc", "desc"]),
    })
    .optional(),
  pagination: paginationSchema,
});

export type ListPeopleInput = z.infer<typeof listPeopleSchema>;

/** What the UI shows for a person, everywhere. One definition so lists and headers agree. */
export function personDisplayName(person: { firstName: string; lastName: string }): string {
  return [person.firstName, person.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}
