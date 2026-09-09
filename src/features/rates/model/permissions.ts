import { createAccessControl, type RoleAuthorizeRequest } from "better-auth/plugins/access";
import { OrgRole } from "@/features/organizations";

/**
 * What each organization role may do to rates. Same shape as `orgStatements` —
 * declared once, granted per role, asked by name.
 */
export const rateStatements = {
  ratePlan: ["read", "create", "update", "archive"],
  rate: ["read", "update"],
} as const;

const ac = createAccessControl(rateStatements);

/**
 * Pricing is a commercial decision, not a shift's. A MEMBER reads plans —
 * quoting a stay needs them — and changes no price: a wrong nightly rate is
 * money, and it reaches every channel the moment it is written.
 */
const RATE_ROLE_AC = {
  [OrgRole.OWNER]: ac.newRole({
    ratePlan: ["read", "create", "update", "archive"],
    rate: ["read", "update"],
  }),
  [OrgRole.ADMIN]: ac.newRole({
    ratePlan: ["read", "create", "update", "archive"],
    rate: ["read", "update"],
  }),
  [OrgRole.MEMBER]: ac.newRole({
    ratePlan: ["read"],
    rate: ["read"],
  }),
};

export function rateCan(
  role: string,
  request: RoleAuthorizeRequest<typeof rateStatements>
): boolean {
  const granted = RATE_ROLE_AC[role as OrgRole];
  return granted ? granted.authorize(request).success : false;
}

export function canReadRates(role: string): boolean {
  return rateCan(role, { rate: ["read"] });
}

/** Writing prices and restrictions — `setRates` and `setRestrictions`. */
export function canSetRates(role: string): boolean {
  return rateCan(role, { rate: ["update"] });
}

export function canManageRatePlans(role: string): boolean {
  return rateCan(role, { ratePlan: ["create", "update"] });
}

export function canArchiveRatePlans(role: string): boolean {
  return rateCan(role, { ratePlan: ["archive"] });
}
