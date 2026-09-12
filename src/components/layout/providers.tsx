"use client";

import { PropsWithChildren } from "react";
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
 */
export default function Providers({ children }: PropsWithChildren) {
  return (
    <TRPCReactProvider>
      <TooltipProvider>
        {children}
        <Toaster richColors position="top-right" />
      </TooltipProvider>
    </TRPCReactProvider>
  );
}
