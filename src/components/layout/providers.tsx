"use client";

import { PropsWithChildren } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TRPCReactProvider } from "@/server/provider";
import NiceModal from "@/store/nice-modal-context";

export default function Providers({ children }: PropsWithChildren) {
  return (
    <TRPCReactProvider>
      <TooltipProvider>
        <NiceModal.Provider>
          {children}
          <Toaster richColors position="top-right" />
        </NiceModal.Provider>
      </TooltipProvider>
    </TRPCReactProvider>
  );
}
