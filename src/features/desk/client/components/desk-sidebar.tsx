"use client";

import { useMemo } from "react";
import { NavUser, type SidebarUser } from "@/components/layout/dashboard/sidebar/nav-user";
import { NavMain } from "@/components/layout/dashboard/sidebar/nav-main";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { PropertySwitcher } from "@/features/properties/client/components/property-switcher";
import { deskNavItems } from "@/config/surface-nav";
import { trpc } from "@/utils/trpc";

/**
 * The desk's sidebar frame, replacing the hand-rolled `DeskNav` —
 * `docs/plans/desk-generation.md` step 4.
 *
 * The caller's role in this organization is not known to a client component,
 * so it is asked for the same way `AppSidebar` asks for it: one query,
 * cached across navigations, that also carries the module toggles and the
 * organization id the property switcher needs. Nothing is shown for "setup"
 * until that answer arrives — the same "nothing until the answer arrives"
 * rule `AppSidebar` follows for its own role-gated items.
 */
export function DeskSidebar({
  orgSlug,
  propertySlug,
  user,
  ...props
}: {
  orgSlug: string;
  propertySlug: string;
  user: SidebarUser;
} & React.ComponentProps<typeof Sidebar>) {
  const access = trpc.organization.moduleAccess.useQuery({ slug: orgSlug }, { staleTime: 60_000 });

  const navItems = useMemo(
    () => deskNavItems(orgSlug, propertySlug, access.data?.role ?? ""),
    [orgSlug, propertySlug, access.data?.role]
  );

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <PropertySwitcher
          organizationId={access.data?.organizationId}
          orgSlug={orgSlug}
          propertySlug={propertySlug}
        />
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
