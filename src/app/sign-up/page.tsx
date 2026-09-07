import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/features/identity/client";
import { auth, configuredSocialProviders } from "@/server/auth";

/** A shell around `<SignUpForm />`. See the note in `sign-in/page.tsx`. */
export default async function SignUpPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">Create your account</h1>
          <p className="text-muted-foreground">It takes less than a minute</p>
        </div>
        <SignUpForm providers={configuredSocialProviders} />
      </div>
    </div>
  );
}
