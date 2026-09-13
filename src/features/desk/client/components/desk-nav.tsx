"use client";

import { useTranslations } from "next-intl";
import { CalendarRange, ClipboardList, DoorClosed, Sparkles, Users, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The desk's sections, down the left.
 *
 * Kontur's shape, which is what this client's staff already have in their
 * hands: the шахматка is one section among several rather than the whole
 * screen, and moving between them is one click at a fixed position.
 *
 * Deliberately not the dashboard's sidebar. That one is organisation-shaped —
 * members, settings, directory — and collapses to icons. This is
 * property-shaped and always visible, because a receptionist moves between
 * these five all day and a collapsed rail costs a hover every time.
 */

const SECTIONS = [
  { id: "grid", segment: "", icon: CalendarRange },
  { id: "today", segment: "today", icon: Sun },
  { id: "bookings", segment: "bookings", icon: ClipboardList },
  { id: "rooms", segment: "rooms", icon: DoorClosed },
  { id: "housekeeping", segment: "housekeeping", icon: Sparkles },
  { id: "guests", segment: "guests", icon: Users },
] as const;

export function DeskNav({ base }: { base: string }) {
  const t = useTranslations("desk");
  const path = usePathname();

  return (
    <nav aria-label={t("nav.label")} className="flex shrink-0 flex-col gap-1 p-2">
      {SECTIONS.map((section) => {
        const href = section.segment ? `${base}/${section.segment}` : base;
        // The grid is the base path, so it would match everything without this.
        const active = section.segment ? path.startsWith(href) : path === base;
        const Icon = section.icon;

        return (
          <Link
            key={section.id}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap",
              "hover:bg-accent hover:text-accent-foreground",
              active && "bg-accent text-accent-foreground font-medium"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {/* Hidden below `lg`, where the label is a rail of icons and the
                accessible name comes from the link's title instead. */}
            <span className="hidden lg:inline">{t(`nav.${section.id}` as never)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
