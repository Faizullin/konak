"use client";

import { useTranslations } from "next-intl";
import { EllipsisVertical, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";

/**
 * What the sidebar footer needs to draw a person. A hand-written shape rather
 * than Better Auth's session type, because this crosses the server/client
 * boundary as props and should carry nothing more than it renders.
 */
export interface SidebarUser {
  name: string;
  email: string;
  image: string | null;
}

function initials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return (
    trimmed
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * The signed-in person, in the sidebar footer.
 *
 * The session arrives as props from `app/dashboard/layout.tsx`, which already
 * reads it for the route guard. Calling `useSession()` here instead would
 * refetch on every navigation and flash an empty avatar first.
 */
export function NavUser({ user }: { user: SidebarUser }) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const t = useTranslations("identity");

  const display = {
    name: user.name || "Account",
    email: user.email,
    avatar: user.image ?? "",
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/");
    // The layout's session read is a server render; without this it would
    // replay from cache and the guard would not fire.
    router.refresh();
  };

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
            <Avatar className="size-8 rounded-lg">
              <AvatarImage src={display.avatar} alt={display.name} />
              <AvatarFallback className="rounded-lg">{initials(display.name)}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{display.name}</span>
              <span className="text-muted-foreground truncate text-xs">{display.email}</span>
            </div>
            <EllipsisVertical className="ml-auto size-4" />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--anchor-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            {/* Base UI's GroupLabel reads MenuGroupContext, so a label must sit
                inside a Group — Radix had no such requirement. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                {display.email || "Signed in"}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="size-4" />
              {t("account.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
