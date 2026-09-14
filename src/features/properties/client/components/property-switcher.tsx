"use client";

import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Hotel } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/utils/trpc";

/**
 * The property switcher, in the desk sidebar's header.
 *
 * Modelled on `OrganizationSwitcher`: the current property comes from the
 * route, not from state, so a deep link shows the right one on first paint. No
 * "new property" entry — adding a hotel is a manager's decision made in the
 * dashboard, not a thing a shift does from the desk.
 */
export function PropertySwitcher({
  organizationId,
  orgSlug,
  propertySlug,
}: {
  /** Undefined until the sidebar's own role lookup resolves it. */
  organizationId: number | undefined;
  orgSlug: string;
  propertySlug: string;
}) {
  const t = useTranslations("properties");
  const { isMobile } = useSidebar();

  const properties = trpc.property.list.useQuery(
    { organizationId: organizationId ?? 0 },
    // The shell renders on every navigation; refetching this every time is
    // noise, same as the organization switcher's own query.
    { enabled: !!organizationId, staleTime: 60_000 }
  );

  const current = properties.data?.find((property) => property.slug === propertySlug);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
              <Hotel className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              {properties.isLoading ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <span className="truncate font-semibold">
                  {current?.name ?? t("switcher.label")}
                </span>
              )}
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--anchor-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            {/* Base UI's GroupLabel reads MenuGroupContext, so the label and the
                items it labels belong inside one Group. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                {t("switcher.label")}
              </DropdownMenuLabel>

              {properties.data?.map((property) => (
                <DropdownMenuItem
                  key={property.id}
                  className="gap-2 p-2"
                  render={<Link href={`/desk/${orgSlug}/${property.slug}`} />}
                >
                  <span className="flex-1 truncate">{property.name}</span>
                  {property.slug === propertySlug && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
