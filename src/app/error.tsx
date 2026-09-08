"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { GENERIC_SERVER_MESSAGE } from "@/lib/errors";

/**
 * Replaces Next's default "Application error" page. The message is not shown —
 * the digest is, since that is what matches this screen to a server log line.
 */
export default function ErrorBoundary({
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground max-w-prose text-sm">{GENERIC_SERVER_MESSAGE}</p>
      {error.digest && (
        <p className="text-muted-foreground font-mono text-xs">Reference: {error.digest}</p>
      )}
      <Button onClick={reset} variant="outline">
        Try again
      </Button>
    </main>
  );
}
