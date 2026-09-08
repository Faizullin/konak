import { SignUpForm } from "@/features/identity/client/components/sign-up-form";
import { configuredSocialProviders } from "@/server/auth";

/** A shell around `<SignUpForm />`. See the note in `sign-in/page.tsx`. */
export default function SignUpPage() {
  return (
    <>
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">Create your account</h1>
        <p className="text-muted-foreground">It takes less than a minute</p>
      </div>
      <SignUpForm providers={configuredSocialProviders} />
    </>
  );
}
