import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { AppearanceToggle } from "@/components/common/appearance-toggle";
import { HeaderInbox } from "./header-inbox";
import { HeaderLocale } from "./header-locale";

/**
 * The dashboard's header, as a component rather than markup in the layout —
 * `docs/plans/dashboard-header.md` § 1. A header with three popovers in it is
 * a component; `app/` holds routing.
 */
export function AppHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <div className="ml-auto flex items-center gap-1">
        <HeaderInbox />
        <HeaderLocale />
        <AppearanceToggle surface="basic" />
      </div>
    </header>
  );
}
