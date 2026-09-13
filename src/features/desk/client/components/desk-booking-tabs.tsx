"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The booking's tabs — which are routes, not state.
 *
 * Kontur's shape, and the reason the booking was given a `publicId` URL in the
 * first place: one receptionist sends a booking to another, and the half they
 * usually mean is the bill. A tab held in component state cannot be sent,
 * refreshed, or opened in a second window beside the grid.
 *
 * `Услуги` is deliberately not here. A service is a folio line of type
 * `SERVICE` and the bill already posts one — a tab that is the same panel with
 * a filter teaches nobody anything. `История` is not here either, and that one
 * is not a choice: `AuditLog` has no writer.
 */

const TABS = [
  { id: "main", segment: "" },
  { id: "bill", segment: "bill" },
] as const;

export function DeskBookingTabs({ base }: { base: string }) {
  const t = useTranslations("desk");
  const path = usePathname();

  return (
    <nav aria-label={t("booking.tabs")} className="-mb-px flex gap-1 border-b">
      {TABS.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const active = tab.segment ? path.startsWith(href) : path === base;

        return (
          <Link
            key={tab.id}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2 text-sm whitespace-nowrap",
              active
                ? "border-primary text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent"
            )}
          >
            {t(`booking.${tab.id}` as never)}
          </Link>
        );
      })}
    </nav>
  );
}
