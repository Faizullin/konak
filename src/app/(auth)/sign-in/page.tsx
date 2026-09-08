import { SignInForm } from "@/features/identity/client";
import { configuredSocialProviders } from "@/server/auth";

/**
 * A shell around `<SignInForm />` — the form is a feature component so it can
 * move into a dialog later without touching routing.
 *
 * Which OAuth providers exist is resolved here, on the server, and passed
 * down; a client component cannot read those env vars. The session guard and
 * the card around this live in `(auth)/layout.tsx`.
 */
export default function SignInPage() {
  return (
    <>
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">Welcome back</h1>
        <p className="text-muted-foreground">Sign in to your account to continue</p>
      </div>
      <SignInForm providers={configuredSocialProviders} />
    </>
  );
}
