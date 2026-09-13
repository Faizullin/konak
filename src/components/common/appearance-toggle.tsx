"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  COLOUR_SCHEMES,
  SURFACES,
  type ColourScheme,
  type Surface,
  type SurfaceId,
} from "@/config/surfaces";

/**
 * Light, dark, or whatever the machine says.
 *
 * Shared chrome rather than either surface's own: the choice is install-wide on
 * purpose — it is about the room a person is sitting in, and a receptionist who
 * sets the desk dark and then opens the dashboard in white has been given a
 * setting that does not mean what it says.
 *
 * What *is* per surface is which palette it wears, and no surface has two yet
 * (`config/surfaces.ts`). The theme row below therefore renders for nobody
 * today, and appears the day a registry entry gains a second entry — from this
 * code, not a later edit of it.
 */

const ICONS: Record<ColourScheme, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export function AppearanceToggle({ surface }: { surface: SurfaceId }) {
  const t = useTranslations("shell");
  const { theme, resolvedTheme, setTheme } = useTheme();

  /**
   * Nothing about the stored choice is knowable until the client runs.
   *
   * `theme` is `undefined` on the server and on the first client pass, so a
   * menu drawn from it hydrates with the wrong item ticked and the wrong icon
   * in the trigger. `useDeskPreferences` has the same shape for the same
   * reason: render the default, then the truth in an effect.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const chosen = (mounted ? (theme as ColourScheme | undefined) : undefined) ?? "system";
  // The trigger shows what is on screen, which for `system` is whichever the
  // machine resolved to — not a third icon nobody can interpret.
  const Icon =
    ICONS[mounted && chosen === "system" ? ((resolvedTheme as ColourScheme) ?? "light") : chosen];

  // Widened through the interface: `satisfies` keeps the literal types, so a
  // surface whose single theme has no `labelKey` is typed without the field at
  // all — and this component has to handle both.
  const themes: Surface["themes"] = SURFACES[surface].themes;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" aria-label={t("appearance.label")}>
            <Icon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t("appearance.scheme")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={chosen} onValueChange={(value) => setTheme(value)}>
          {COLOUR_SCHEMES.map((scheme) => {
            const SchemeIcon = ICONS[scheme];
            return (
              <DropdownMenuRadioItem key={scheme} value={scheme}>
                <SchemeIcon className="size-4" />
                {t(`appearance.${scheme}`)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>

        {/* Absent because the registry says this surface has one palette, not
            because it was never written. */}
        {themes.length > 1 && (
          <DropdownMenuRadioGroup value={themes[0]!.id}>
            {themes.map((palette) => (
              <DropdownMenuRadioItem key={palette.id} value={palette.id}>
                {palette.labelKey ? t(palette.labelKey as never) : palette.id}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
