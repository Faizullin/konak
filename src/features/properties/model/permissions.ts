import { createAccessControl, type RoleAuthorizeRequest } from "better-auth/plugins/access";
import { OrgRole } from "@/features/organizations";

/**
 * What each organization role may do to a property's inventory. Same shape as
 * `orgStatements` — declared once, granted per role, asked by name.
 */
export const propertyStatements = {
  roomType: ["read", "create", "update", "archive"],
  room: ["read", "create", "update", "archive"],
} as const;

const ac = createAccessControl(propertyStatements);

/**
 * Setting a property up is a manager's job. A MEMBER is a receptionist: they
 * read these axes all day — the grid is drawn from them — but adding a room
 * type mid-shift is not a thing a shift does.
 */
const PROPERTY_ROLE_AC = {
  [OrgRole.OWNER]: ac.newRole({
    roomType: ["read", "create", "update", "archive"],
    room: ["read", "create", "update", "archive"],
  }),
  [OrgRole.ADMIN]: ac.newRole({
    roomType: ["read", "create", "update", "archive"],
    room: ["read", "create", "update", "archive"],
  }),
  [OrgRole.MEMBER]: ac.newRole({
    roomType: ["read"],
    room: ["read"],
  }),
};

export function propertyCan(
  role: string,
  request: RoleAuthorizeRequest<typeof propertyStatements>
): boolean {
  const granted = PROPERTY_ROLE_AC[role as OrgRole];
  return granted ? granted.authorize(request).success : false;
}

export function canReadInventory(role: string): boolean {
  return propertyCan(role, { room: ["read"] });
}

export function canManageRooms(role: string): boolean {
  return propertyCan(role, { room: ["create", "update"] });
}

export function canArchiveRooms(role: string): boolean {
  return propertyCan(role, { room: ["archive"] });
}

export function canManageRoomTypes(role: string): boolean {
  return propertyCan(role, { roomType: ["create", "update"] });
}

export function canArchiveRoomTypes(role: string): boolean {
  return propertyCan(role, { roomType: ["archive"] });
}
