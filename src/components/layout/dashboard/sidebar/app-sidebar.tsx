"use client";

import { useParams } from "next/navigation";
import { useMemo } from "react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { accountNavItems, filterNavByRole, organizationNavItems } from "@/config/nav-items";
import { UserRole } from "@/features/identity";
import { OrganizationSwitcher } from "@/features/organizations/client";
import { NavMain } from "./nav-main";
import { NavUser, type SidebarUser } from "./nav-user";

/**
 * The sidebar frame: header, a slot, footer.
 *
 * `SidebarContent` has two levels and the level is derived from the **route**,
 * never from state — so a deep link renders the correct sidebar on first paint
 * and nothing has to be kept in sync:
 *
 *   /dashboard/*               account nav
 *   /dashboard/orgs/[orgId]/*  that organization's nav
 *
 * A third level (per-feature nav inside an organization) drops in the same
 * way: read another route param, return another `NavGroup[]`. The frame knows
 * how to pick a level; it does not know what any feature needs.
 *
 * The signed-in person comes in as a prop from the dashboard layout's session
 * read — both the footer and the role-gated nav items are served by that one
 * server-side read rather than a query per navigation.
 */
export function AppSidebar({
  user,
  ...props
}: { user: SidebarUser & { role: UserRole } } & React.ComponentProps<typeof Sidebar>) {
  const params = useParams<{ orgId?: string }>();

  const organizationId = params?.orgId ? Number(params.orgId) : undefined;

  const navItems = useMemo(() => {
    if (organizationId) return organizationNavItems(organizationId);
    return filterNavByRole(accountNavItems, user.role);
  }, [organizationId, user.role]);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <OrganizationSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <NavMain items={navItems} />
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
