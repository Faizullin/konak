import { z } from "zod";

/**
 * SQLite has no native enum type, so `User.role` is a column of strings and
 * the enum lives here instead — one isomorphic definition the server
 * validates against and the client renders from.
 */
export const UserRole = {
  USER: "USER",
  ADMIN: "ADMIN",
  MODERATOR: "MODERATOR",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const USER_ROLE_VALUES = Object.values(UserRole);

export const userRoleSchema = z.enum(USER_ROLE_VALUES);

/**
 * The shape the API returns for a user. `id` is a Better Auth string, not a
 * uuid — never validate it with `z.uuid()`.
 */
export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  role: userRoleSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type User = z.infer<typeof userSchema>;

export const listUsersInputSchema = z.object({
  filter: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      role: userRoleSchema.optional(),
    })
    .optional(),
  orderBy: z
    .object({
      field: z.enum(["createdAt", "name", "email", "role"]),
      direction: z.enum(["asc", "desc"]),
    })
    .optional(),
  pagination: z.object({
    skip: z.number().min(0).default(0),
    take: z.number().min(1).max(100).default(10),
  }),
});

export type ListUsersInput = z.infer<typeof listUsersInputSchema>;

export const updateProfileInputSchema = z.object({
  name: z.string().min(1).max(64),
});

export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;
