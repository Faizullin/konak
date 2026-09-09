import { z } from "zod";
import { addressSchema, emailField, paginationSchema } from "./party";

export const COMPANY_SORT_FIELDS = ["name", "createdAt"] as const;

export const createCompanySchema = z.object({
  organizationId: z.number(),
  name: z.string().min(1, "name_required").max(160),
  legalName: z.string().max(200).optional(),
  taxId: z.string().max(64).optional(),
  email: emailField,
  phone: z.string().max(40).optional(),
  website: z.url("url_invalid").optional().or(z.literal("")),
  notes: z.string().max(2000).optional(),
  address: addressSchema.optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const companyFormSchema = createCompanySchema.omit({ organizationId: true });

export type CompanyFormInput = z.infer<typeof companyFormSchema>;

export const updateCompanySchema = companyFormSchema.partial().extend({ id: z.number() });

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const listCompaniesSchema = z.object({
  organizationId: z.number(),
  filter: z
    .object({
      search: z.string().optional(),
      includeArchived: z.boolean().optional(),
    })
    .optional(),
  orderBy: z
    .object({
      field: z.enum(COMPANY_SORT_FIELDS),
      direction: z.enum(["asc", "desc"]),
    })
    .optional(),
  pagination: paginationSchema,
});

export type ListCompaniesInput = z.infer<typeof listCompaniesSchema>;

export const linkPersonSchema = z.object({
  personId: z.number(),
  companyId: z.number(),
  jobTitle: z.string().max(120).optional(),
  isPrimary: z.boolean().default(false),
});

export type LinkPersonInput = z.infer<typeof linkPersonSchema>;
