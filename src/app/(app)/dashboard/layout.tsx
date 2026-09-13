import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AppSidebar } from "@/components/layout/dashboard/sidebar/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { NiceModalProvider } from "@/store/nice-modal-context";
import { UserRole } from "@/features/identity";
import { auth } from "@/server/auth";

/**
 * The gate for everything under `/dashboard`, and the shell it renders in.
 *
 * The guard is here rather than in middleware so it sits on the resource it
 * protects, and so the session it reads can be reused: the same object feeds
 * the sidebar footer and the role-gated nav, sparing the client a query on
 * every navigation.
 *
 * The sidebar's open/closed state is read from a cookie on the server, so the
 * first paint matches what the person left it as instead of flashing open and
 * snapping shut.
 *
 * The provider carries only `errors`, which is what every screen beneath needs
 * to say why a mutation was refused. A namespace is added here when a screen
 * under it renders one — mounting them all would put every string in every
 * bundle, and the shared chunk is where that would show.
 */
export default async function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/sign-in");
  }

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  const user = {
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? null,
    role: (session.user.role as UserRole) ?? UserRole.USER,
  };

  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{
        directory: messages.directory,
        enums: messages.enums,
        errors: messages.errors,
        housekeeping: messages.housekeeping,
        identity: messages.identity,
        organizations: messages.organizations,
        platform: messages.platform,
        properties: messages.properties,
        rates: messages.rates,
        reservations: messages.reservations,
        validation: messages.validation,
      }}
    >
      {/* Inside the translator, not above it: a dialog is rendered where its
          provider sits, and every one of ours reads `useTranslations`. */}
      <NiceModalProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <AppSidebar user={user} />
          <SidebarInset>
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
            </header>
            <div className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </NiceModalProvider>
    </NextIntlClientProvider>
  );
}
