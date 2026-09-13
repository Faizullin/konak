"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeskLocale } from "./desk-locale";

/**
 * The top bar: where you are, and what you can do here.
 *
 * One row, about 48px. The dashboard's `PageHeader` spends roughly 120px on a
 * heading and a description above a screen whose vertical space is rows of
 * rooms — that is right for a settings page and wrong for a desk read for eight
 * hours.
 */
export function DeskBar({
  property,
  section,
  actions,
  dashboardHref,
}: {
  property: string;
  section: string;
  actions?: ReactNode;
  /** Back to the organisation's own screens — settings, members, the rest. */
  dashboardHref?: string;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <span className="truncate text-sm font-semibold">{property}</span>
      <span className="text-muted-foreground" aria-hidden>
        /
      </span>
      <h1 className="truncate text-sm">{section}</h1>

      {/* The section's own controls first, then the ones that are always here.
          Order matters: a person reaches for what changes, not for what does
          not. */}
      <div className="ml-auto flex items-center gap-1">
        {actions}
        <DeskLocale />
        {dashboardHref && (
          <Button
            nativeButton={false}
            variant="ghost"
            size="sm"
            render={<Link href={dashboardHref} />}
          >
            <LayoutDashboard className="size-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
