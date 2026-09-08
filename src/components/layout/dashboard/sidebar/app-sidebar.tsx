"use client";

import { useParams } from "next/navigation";
import { useMemo } from "react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { accountNavItems, filterNavByRole, organizationNavItems } from "@/config/nav-items";
import { UserRole } from "@/features/identity";
import { OrganizationSwitcher } from "@/features/organizations/client/components/organization-switcher";
import { trpc } from "@/utils/trpc";
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
 *   /dashboard/orgs/[orgSlug]/*  that organization's nav
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
  const params = useParams<{ orgSlug?: string }>();

  const orgSlug = params?.orgSlug;

  // The organization's own nav depends on two things a route cannot know: the
  // caller's role in it, and which modules it has on. The shell renders on
  // every navigation, so this is cached like the switcher's own query.
  const access = trpc.organization.moduleAccess.useQuery(
    { slug: orgSlug ?? "" },
    { enabled: !!orgSlug, staleTime: 60_000 }
  );

  const navItems = useMemo(() => {
    if (!orgSlug) return filterNavByRole(accountNavItems, user.role);
    // Nothing until the answer arrives: showing a module and withdrawing it is
    // worse than a moment with only the back link.
    if (!access.data) return organizationNavItems(orgSlug, "", []);
    return organizationNavItems(orgSlug, access.data.role, access.data.toggles);
  }, [orgSlug, user.role, access.data]);

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
