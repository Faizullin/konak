"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { GENERIC_SERVER_MESSAGE } from "@/lib/errors";

/**
 * The root boundary is full-screen and would take the sidebar with it, leaving
 * nowhere to go but the back button. This replaces the content pane only —
 * the layout sits above the boundary, so the shell keeps rendering.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-4 py-12">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-muted-foreground text-sm">{GENERIC_SERVER_MESSAGE}</p>
      </div>
      {error.digest && (
        <p className="text-muted-foreground font-mono text-xs">Reference: {error.digest}</p>
      )}
      <Button onClick={reset} variant="outline" size="sm">
        Try again
      </Button>
    </div>
  );
}
