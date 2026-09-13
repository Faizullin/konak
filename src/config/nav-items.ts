import {
  Building2,
  CalendarRange,
  ChevronLeft,
  Contact,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { UserRole } from "@/features/identity";
import { orgModule, visibleOrgModules, type ModuleToggle } from "@/features/organizations";

/**
 * Sidebar navigation, as data.
 *
 * The nav is a config file rather than JSX so the same renderer can draw the
 * account-level nav and any organization-level nav, and so gating an item on a
 * role is a field (`roles`) instead of a conditional buried in markup.
 *
 * Two levels exist, and which one shows is derived from the route — see
 * `app-sidebar.tsx`.
 */

export interface NavMainItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  comingSoon?: boolean;
  newTab?: boolean;
  subItems?: NavMainItem[];
  /** Install-wide roles allowed to see this. Absent means everyone. */
  roles?: UserRole[];
}

export interface NavGroup {
  id: string;
  label?: string;
  items: NavMainItem[];
}

/** Level 1: the person's own account, outside any organization. */
export const accountNavItems: NavGroup[] = [
  {
    id: "main",
    label: "main",
    items: [
      {
        title: "overview",
        url: "/dashboard",
        icon: LayoutDashboard,
      },
      {
        title: "organizations",
        url: "/dashboard/orgs",
        icon: Building2,
      },
      {
        title: "users",
        url: "/dashboard/users",
        icon: Users,
        roles: [UserRole.ADMIN],
      },
    ],
  },
];

/**
 * Level 2: inside one organization. A function, not a constant, because every
 * url carries the slug — building them here keeps it in one place rather than
 * in each nav component.
 */
const ORG_ICONS: Record<string, LucideIcon> = {
  CalendarRange,
  Contact,
  LayoutDashboard,
  Users,
  Settings,
};

export function organizationNavItems(
  orgSlug: string,
  role: string,
  toggles: ModuleToggle[] = []
): NavGroup[] {
  const base = `/dashboard/orgs/${orgSlug}`;

  // Only modules this organization has on and this role may see. Hiding the
  // entry is a courtesy — the procedure and the route both re-check.
  const dynamicItems = visibleOrgModules(role, toggles).map((id) => {
    const definition = orgModule(id);
    return {
      title: definition.label,
      url: definition.segment ? `${base}/${definition.segment}` : base,
      icon: ORG_ICONS[definition.icon],
    };
  });

  return [
    {
      id: "back",
      items: [{ title: "allOrganizations", url: "/dashboard/orgs", icon: ChevronLeft }],
    },
    {
      id: "organization",
      label: "organization",
      items: dynamicItems,
    },
  ];
}

/** Drop anything the person's install-wide role does not allow. */
export function filterNavByRole(groups: NavGroup[], role: UserRole): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
    }))
    .filter((group) => group.items.length > 0);
}
