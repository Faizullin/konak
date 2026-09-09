import { SignUpForm } from "@/features/identity/client/components/sign-up-form";
import { getTranslations } from "next-intl/server";
import { configuredSocialProviders } from "@/server/auth";

/** A shell around `<SignUpForm />`. See the note in `sign-in/page.tsx`. */
export default async function SignUpPage() {
  const t = await getTranslations("auth.signUp");

  return (
    <>
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <SignUpForm providers={configuredSocialProviders} />
    </>
  );
}
