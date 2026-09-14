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
 * The language, in the header rather than inside the account menu.
 *
 * `docs/plans/dashboard-header.md` § 2 — two controls for one setting is how
 * they drift, so this replaces `chooseLocale` in `nav-user.tsx` rather than
 * sitting beside it. The desk keeps its own, `desk-locale.tsx`: a surface owns
 * its own chrome.
 *
 * There is no locale in the URL — the choice is a cookie the server reads on
 * the next render, which is why this calls `refresh()` rather than navigating.
 */
export function HeaderLocale() {
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
