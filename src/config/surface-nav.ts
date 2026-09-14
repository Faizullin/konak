import {
  CalendarRange,
  ClipboardList,
  DoorClosed,
  Settings,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import { canManageProperties } from "@/features/properties";
import type { NavGroup } from "@/config/nav-items";

/**
 * The desk's own nav, in the shape `NavMain` already knows how to draw.
 *
 * A function of the route and the caller's role, like `organizationNavItems` —
 * the desk is one property at a time, so every url is built here rather than
 * threaded through the sidebar frame.
 *
 * Setup is the one gated entry. Hiding it is a courtesy, same as
 * `visibleOrgModules` — the panels it opens re-check `canManageRooms` and
 * friends per mutation regardless of whether the link was ever shown.
 */
export function deskNavItems(orgSlug: string, propertySlug: string, role: string): NavGroup[] {
  const base = `/desk/${orgSlug}/${propertySlug}`;

  const groups: NavGroup[] = [
    {
      id: "sections",
      items: [
        { title: "grid", url: base, icon: CalendarRange },
        { title: "today", url: `${base}/today`, icon: Sun },
        { title: "bookings", url: `${base}/bookings`, icon: ClipboardList },
        { title: "rooms", url: `${base}/rooms`, icon: DoorClosed },
        { title: "housekeeping", url: `${base}/housekeeping`, icon: Sparkles },
        { title: "guests", url: `${base}/guests`, icon: Users },
      ],
    },
  ];

  if (canManageProperties(role)) {
    groups.push({
      id: "setup",
      items: [{ title: "setup", url: `${base}/setup`, icon: Settings }],
    });
  }

  return groups;
}
