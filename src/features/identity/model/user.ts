import { createAccessControl, type RoleAuthorizeRequest } from "better-auth/plugins/access";
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

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  USER: "User",
  ADMIN: "Admin",
  MODERATOR: "Moderator",
};

/**
 * Install-wide capabilities, in the same shape `organizations` uses for its
 * own — see [architecture.md](../../../../docs/guides/architecture.md). Two
 * verbs, because two procedures are guarded: `user.adminList` and
 * `user.updateRole`.
 *
 * Not to be confused with `OrgRole`, which is scoped to one organization. This
 * table answers "what may this account do to the install", and it is free to
 * consult because the role rides on the session.
 */
export const userStatements = {
  user: ["list", "set-role"],
} as const;

const ac = createAccessControl(userStatements);

/**
 * MODERATOR is granted nothing, which is the honest encoding of what it means
 * today: the role exists in the enum and no code has ever consulted it. Giving
 * it `list` would change who can read the user table — a product decision, not
 * a refactor. The empty grant makes that a visible gap rather than a silent
 * one.
 */
const USER_ROLE_AC = {
  [UserRole.ADMIN]: ac.newRole({ user: ["list", "set-role"] }),
  [UserRole.MODERATOR]: ac.newRole({}),
  [UserRole.USER]: ac.newRole({}),
};

/**
 * Ask whether `role` may do something. The session carries the role as a
 * plain string, so an unrecognised one is denied rather than throwing — a
 * column edited by hand cannot escalate.
 */
export function userCan(
  role: string,
  request: RoleAuthorizeRequest<typeof userStatements>
): boolean {
  const granted = USER_ROLE_AC[role as UserRole];
  return granted ? granted.authorize(request).success : false;
}

/** The named questions the app asks. Same relationship as `canManageMembers`. */
export function canListUsers(role: string): boolean {
  return userCan(role, { user: ["list"] });
}

export function canSetUserRole(role: string): boolean {
  return userCan(role, { user: ["set-role"] });
}

/**
 * Whether this role change could strip the install of its last admin — the only
 * case worth a `COUNT`. Asking it first means a promotion never costs one.
 */
export function couldRemoveLastAdmin(targetRole: string, nextRole: UserRole): boolean {
  return targetRole === UserRole.ADMIN && nextRole !== UserRole.ADMIN;
}

/**
 * `otherAdminCount` excludes the target, so zero means nobody would be left who
 * can reach `adminProcedure` — and there is no in-app way back. Knows nothing
 * about the caller: the invariant is *last admin*, not *self*.
 */
export function isLastAdmin(otherAdminCount: number): boolean {
  return otherAdminCount === 0;
}

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
