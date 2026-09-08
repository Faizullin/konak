import { createAccessControl, type RoleAuthorizeRequest } from "better-auth/plugins/access";
import { OrgRole } from "@/features/organizations";

/**
 * What each organization role may do to the directory. Same shape as
 * `orgStatements` — declared once, granted per role, asked by name.
 */
export const directoryStatements = {
  person: ["create", "read", "update", "archive"],
  company: ["create", "read", "update", "archive"],
} as const;

const ac = createAccessControl(directoryStatements);

/**
 * A MEMBER is a receptionist: they create and edit guests all day. Archiving is
 * a manager's call, and companies are a commercial record they only read.
 */
const DIRECTORY_ROLE_AC = {
  [OrgRole.OWNER]: ac.newRole({
    person: ["create", "read", "update", "archive"],
    company: ["create", "read", "update", "archive"],
  }),
  [OrgRole.ADMIN]: ac.newRole({
    person: ["create", "read", "update", "archive"],
    company: ["create", "read", "update", "archive"],
  }),
  [OrgRole.MEMBER]: ac.newRole({
    person: ["create", "read", "update"],
    company: ["read"],
  }),
};

export function directoryCan(
  role: string,
  request: RoleAuthorizeRequest<typeof directoryStatements>
): boolean {
  const granted = DIRECTORY_ROLE_AC[role as OrgRole];
  return granted ? granted.authorize(request).success : false;
}

export function canReadDirectory(role: string): boolean {
  return directoryCan(role, { person: ["read"] });
}

export function canManagePeople(role: string): boolean {
  return directoryCan(role, { person: ["create", "update"] });
}

export function canArchivePeople(role: string): boolean {
  return directoryCan(role, { person: ["archive"] });
}

export function canManageCompanies(role: string): boolean {
  return directoryCan(role, { company: ["create", "update"] });
}
