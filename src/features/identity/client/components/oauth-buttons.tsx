"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useErrorHandlers } from "@/lib/errors";

/**
 * The social half of the credential screens.
 *
 * Which providers exist is decided on the server and passed in — reading env
 * from a client component would either leak a secret or require a
 * `NEXT_PUBLIC_` mirror of something the server already knows.
 *
 * Renders nothing when no provider is configured, so a fresh clone with only
 * `BETTER_AUTH_SECRET` set shows a plain email form rather than a stray
 * divider over an empty row.
 */

export type OAuthProvider = "github" | "google";

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  github: "GitHub",
  google: "Google",
};

export function OAuthButtons({
  providers,
  callbackURL = "/dashboard",
}: {
  providers: OAuthProvider[];
  callbackURL?: string;
}) {
  const { handleError } = useErrorHandlers();
  const [pending, setPending] = useState<OAuthProvider | null>(null);

  if (providers.length === 0) return null;

  const handleClick = async (provider: OAuthProvider) => {
    setPending(provider);
    // On success this redirects, so there is no success branch to write and
    // `pending` is only ever cleared on failure.
    const { error } = await authClient.signIn.social({ provider, callbackURL });
    if (error) {
      handleError(error, {
        fallbackMessage: `Could not continue with ${PROVIDER_LABELS[provider]}`,
      });
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        {providers.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => handleClick(provider)}
          >
            Continue with {PROVIDER_LABELS[provider]}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs">or</span>
        <span className="bg-border h-px flex-1" />
      </div>
    </div>
  );
}
