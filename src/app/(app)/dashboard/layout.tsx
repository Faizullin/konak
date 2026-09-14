import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AppHeader } from "@/components/layout/dashboard/header/app-header";
import { AppSidebar } from "@/components/layout/dashboard/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { NiceModalProvider } from "@/store/nice-modal-context";
import { UserRole } from "@/features/identity";
import { auth } from "@/server/auth";
import { SURFACES } from "@/config/surfaces";

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
        billing: messages.billing,
        channels: messages.channels,
        directory: messages.directory,
        enums: messages.enums,
        errors: messages.errors,
        housekeeping: messages.housekeeping,
        identity: messages.identity,
        nav: messages.nav,
        organizations: messages.organizations,
        platform: messages.platform,
        properties: messages.properties,
        rates: messages.rates,
        reservations: messages.reservations,
        shell: messages.shell,
        validation: messages.validation,
      }}
    >
      {/* Inside the translator, not above it: a dialog is rendered where its
          provider sits, and every one of ours reads `useTranslations`. */}
      <NiceModalProvider>
        {/* The dashboard names itself, like the desk does.
            It inherited `:root` before, which made stock shadcn implicit and
            the desk the special case; now both surfaces are the same kind of
            thing and a second palette for either is a CSS block rather than a
            CSS block plus a layout edit. No `basic.css` is written until there
            is something to put in it. */}
        <SidebarProvider defaultOpen={defaultOpen} data-surface={SURFACES.basic.id}>
          <AppSidebar user={user} />
          <SidebarInset>
            <AppHeader />
            {/* Wide enough for the screen this product is about: a 31-night grid at
              comfortable density is 88rem, and the old 5xl cap (976px) showed
              twenty nights on any monitor. Still capped, because a line of
              prose across an ultrawide is unreadable. */}
            <div className="mx-auto w-full max-w-[110rem] flex-1 p-6">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </NiceModalProvider>
    </NextIntlClientProvider>
  );
}
