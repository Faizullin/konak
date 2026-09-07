import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignInForm } from "@/features/identity/client";
import { auth, configuredSocialProviders } from "@/server/auth";

/**
 * A shell around `<SignInForm />` — the form is a feature component so it can
 * move into a dialog later without touching routing.
 *
 * Which OAuth providers exist is resolved here, on the server, and passed
 * down; a client component cannot read those env vars.
 */
export default async function SignInPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">Welcome back</h1>
          <p className="text-muted-foreground">Sign in to your account to continue</p>
        </div>
        <SignInForm providers={configuredSocialProviders} />
      </div>
    </div>
  );
}
