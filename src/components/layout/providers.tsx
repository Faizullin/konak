"use client";

import { PropsWithChildren } from "react";
import { ThemeProvider } from "next-themes";
import { THEME_STORAGE_KEY } from "@/config/surfaces";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TRPCReactProvider } from "@/server/provider";

/**
 * The providers every route needs.
 *
 * **`NiceModal.Provider` is not here**, and that is the whole point: a modal is
 * rendered where its provider sits, and this is above `NextIntlClientProvider`
 * — which the dashboard layout mounts, because `ui-patterns.md` gives a route
 * the namespaces it renders rather than shipping all of them everywhere. A
 * modal opened from up here therefore had no translator, and every dialog in
 * the product threw the moment it opened. It lives in the dashboard layout now,
 * inside the context its contents read.
 *
 * **`ThemeProvider` is here**, at the root, for the opposite reason: light or
 * dark is about the room a person is sitting in, so it has to follow them from
 * the dashboard to the desk to the sign-in page without any of those files
 * being edited. It is also the one preference that is *not* a cookie — the
 * `dark` variant is class-based and only the browser knows what the OS wants,
 * so a cookie could store `light`/`dark` and would lose `system` entirely.
 *
 * `next-themes` has been in this bundle since the template, dragged in by
 * `components/ui/sonner.tsx`, which has been calling `useTheme()` outside any
 * provider and falling back to `"system"` ever since. Mounting the provider
 * adds the provider, not the library — and fixes the toasts in passing.
 */
export default function Providers({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // Otherwise every transition on the page animates the repaint, and the
      // switch looks like a fade rather than a setting.
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
    >
      <TRPCReactProvider>
        <TooltipProvider>
          {children}
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </TRPCReactProvider>
    </ThemeProvider>
  );
}
