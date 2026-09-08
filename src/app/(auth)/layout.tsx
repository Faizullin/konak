import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ReactNode } from "react";
import { auth } from "@/server/auth";

/**
 * The credential screens share one rule: whoever is signed in has no business
 * here. A route group adds this layout without adding a URL segment.
 */
export default async function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md space-y-8">{children}</div>
    </div>
  );
}
