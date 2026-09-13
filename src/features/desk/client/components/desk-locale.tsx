"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALE_COOKIE, LOCALE_LABELS, LOCALES } from "@/config/locales";
import { cn } from "@/lib/utils";

/**
 * The language, in the bar rather than four clicks away.
 *
 * On the dashboard this lives inside the sidebar's user menu, which is right
 * for a setting somebody changes once. Here it is a desk control: the staff who
 * read this screen read it in Russian, and whoever demonstrates it switches
 * back and forth. A control used often belongs where it is visible.
 *
 * There is no locale in the URL — the choice is a cookie the server reads on
 * the next render, which is why this calls `refresh()` rather than navigating.
 */
export function DeskLocale() {
  const locale = useLocale();
  const router = useRouter();

  const choose = (next: string) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" aria-label={LOCALE_LABELS[locale]} />}
      >
        <Languages className="size-4" />
        <span className="text-xs uppercase">{locale}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((value) => (
          <DropdownMenuItem key={value} onClick={() => choose(value)}>
            <span className={cn("w-4 text-xs", value !== locale && "invisible")}>✓</span>
            {LOCALE_LABELS[value]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
