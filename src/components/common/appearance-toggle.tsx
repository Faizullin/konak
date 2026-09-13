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
import { useRouter } from "next/navigation";
import {
  ATTRIBUTE_THEMED,
  COLOUR_SCHEMES,
  DEFAULT_THEME,
  SURFACES,
  themeCookie,
  toTheme,
  type ColourScheme,
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
 * What *is* per surface is which palette it wears — the desk has two, the
 * dashboard one, and the row below appears or does not because of the registry
 * rather than because of a condition written here.
 *
 * The two halves are stored differently on purpose. The scheme is
 * `next-themes` in `localStorage`, because `system` is only knowable in a
 * browser. A theme is a **cookie**, because the server can resolve it and paint
 * the first frame right — the surface's layout stamps `data-theme` before this
 * component exists.
 */

/** `document.cookie` is a single string of `a=1; b=2`, and this wants one of them. */
function readThemeCookie(surface: SurfaceId): string {
  const name = themeCookie(surface);
  const found = document.cookie
    .split("; ")
    .find((pair) => pair.startsWith(`${name}=`))
    ?.slice(name.length + 1);

  return toTheme(surface, found);
}

const ICONS: Record<ColourScheme, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export function AppearanceToggle({ surface }: { surface: SurfaceId }) {
  const t = useTranslations("shell");
  const router = useRouter();
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

  /**
   * The palette, read from the cookie rather than passed down.
   *
   * The layout has already resolved it and stamped `data-theme`, so the *page*
   * is right on the first frame — this value only decides which row is ticked
   * inside a menu that is shut until somebody clicks it, which is long after
   * mount. Threading it through eight pages to be correct a few milliseconds
   * earlier in a closed popover would have been the wrong trade.
   */
  const palette = mounted ? readThemeCookie(surface) : DEFAULT_THEME;

  const chosen = (mounted ? (theme as ColourScheme | undefined) : undefined) ?? "system";
  // The trigger shows what is on screen, which for `system` is whichever the
  // machine resolved to — not a third icon nobody can interpret.
  const Icon =
    ICONS[mounted && chosen === "system" ? ((resolvedTheme as ColourScheme) ?? "light") : chosen];

  const { themes, base } = SURFACES[surface];

  /**
   * A row only for a base whose themes this product knows how to switch.
   *
   * `shadcn` means Tailwind and custom properties, so a theme is an attribute
   * on an element already on screen. A vendor base ships *compiled* stylesheets
   * per theme and switching one is choosing which file loads — a different
   * mechanism, and drawing this control for it would be a button that lies.
   */
  const switchable = themes.length > 1 && ATTRIBUTE_THEMED.includes(base);

  // The cookie the surface's layout reads on the next render, which is why this
  // refreshes rather than navigating — the same shape `DeskLocale` uses.
  const choose = (next: string) => {
    document.cookie = `${themeCookie(surface)}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

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
        <DropdownMenuRadioGroup value={chosen} onValueChange={(value) => setTheme(value)}>
          {/* Inside the group, not above it. `DropdownMenuLabel` is Base UI's
              `Menu.GroupLabel`, which throws without a `Menu.Group` or
              `Menu.RadioGroup` around it — and the throw lands in the error
              boundary, so the menu simply never opens. */}
          <DropdownMenuLabel>{t("appearance.scheme")}</DropdownMenuLabel>
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

        {switchable && (
          <DropdownMenuRadioGroup value={palette} onValueChange={(value) => choose(value)}>
            {/* Inside the group for the same reason as the label above it. */}
            <DropdownMenuLabel>{t("appearance.theme")}</DropdownMenuLabel>
            {themes.map((entry) => (
              <DropdownMenuRadioItem key={entry.id} value={entry.id}>
                {/* A template, so `message-keys.test` counts the whole
                    `shell.theme.` prefix as read — and so a new palette is a
                    registry line and a message, with nothing to wire. */}
                {t(`theme.${entry.id}` as never)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
