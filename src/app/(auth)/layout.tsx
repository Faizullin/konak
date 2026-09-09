import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { auth } from "@/server/auth";

/**
 * The credential screens share one rule: whoever is signed in has no business
 * here. A route group adds this layout without adding a URL segment.
 *
 * The provider is here rather than in the root layout, and carries only the
 * `auth` namespace: a client tree is given the strings it renders, not every
 * string in the app. The dashboard gets its own when it needs one.
 */
export default async function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    redirect("/dashboard");
  }

  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md space-y-8">
        <NextIntlClientProvider
          locale={locale}
          messages={{
            auth: messages.auth,
            errors: messages.errors,
            validation: messages.validation,
          }}
        >
          {children}
        </NextIntlClientProvider>
      </div>
    </div>
  );
}
