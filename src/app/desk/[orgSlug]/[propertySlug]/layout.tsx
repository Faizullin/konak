import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { DeskSidebar } from "@/features/desk/client/components/desk-sidebar";
import { isOrgModuleEnabled } from "@/features/organizations";
import { organizationBySlug } from "@/features/organizations/server";
import { NiceModalProvider } from "@/store/nice-modal-context";
import { SurfaceLinksProvider } from "@/store/surface-links";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { themeCookie, toTheme } from "@/config/surfaces";
import { auth } from "@/server/auth";
import prisma from "@/server/db";

/**
 * The desk: a second surface, beside the dashboard rather than inside it.
 *
 * **It edits nothing that exists.** Every procedure these screens call is
 * already written and tested; what is new is the layout they are drawn in.
 * Deleting this folder leaves the product exactly as it was, which is what
 * makes the surface safe to build fast.
 *
 * Two things differ from `dashboard/layout.tsx`, and each is a decision:
 *
 * - **No reading measure.** The dashboard caps its content because it holds
 *   forms and prose. A 31-night grid is 88rem at comfortable density, so this
 *   surface is full width, always.
 * - **A 48px bar instead of a 120px heading.** Vertical space here is rows of
 *   rooms.
 *
 * The sidebar itself is the dashboard's own frame — `Sidebar`/`NavMain`/
 * `NavUser`, `collapsible="icon"`, the same `sidebar_state` cookie —
 * `docs/plans/desk-generation.md` step 4. Two shells hand-drawing the same
 * frame was the debt; two shells wearing different palettes over one frame is
 * not.
 *
 * The session guard sits on the resource rather than in middleware, for the
 * same reason the dashboard's does.
 */
export default async function DeskLayout({
  children,
  params,
}: Readonly<{
  children: ReactNode;
  params: Promise<{ orgSlug: string; propertySlug: string }>;
}>) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/sign-in");
  }

  const { orgSlug, propertySlug } = await params;

  const organization = await organizationBySlug(orgSlug);
  if (!organization) {
    notFound();
  }

  const toggles = await prisma.organizationModule.findMany({
    where: { organizationId: organization.id },
    select: { moduleId: true, enabled: true },
  });
  if (!isOrgModuleEnabled("FRONT_DESK", toggles)) {
    notFound();
  }

  const [locale, messages, jar] = await Promise.all([getLocale(), getMessages(), cookies()]);

  const defaultOpen = jar.get("sidebar_state")?.value !== "false";
  const user = {
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? null,
  };

  /**
   * Which palette this surface is wearing, resolved **here** rather than in the
   * browser.
   *
   * A theme needs no asking the machine anything, so the server can know it and
   * paint the first frame right — no flash, no effect, no inline script. That
   * is the whole reason it is a cookie and the colour scheme is not:
   * `system` is only knowable in a browser.
   */
  const theme = toTheme("desk", jar.get(themeCookie("desk"))?.value);

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{
        // Only what this surface renders. Mounting every namespace would put
        // every string in every bundle, which is measurable — the dashboard
        // layout carries a different set for the same reason.
        billing: messages.billing,
        channels: messages.channels,
        desk: messages.desk,
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
      {/* The grid, the day lists and the bookings table are the dashboard's
          components, and they used to build the dashboard's links inline. This
          is what keeps a chip clicked here inside this shell. */}
      <SurfaceLinksProvider
        stem={`/desk/${orgSlug}`}
        directory={`/desk/${orgSlug}/${propertySlug}/guests`}
      >
        {/* Inside the translator: a modal renders where its provider sits, and
            every dialog reads `useTranslations`. */}
        <NiceModalProvider>
          {/* The one place the desk's look is switched on. Everything beneath
            reads tokens, so a second treatment is another block in
            `styles/desk.css` rather than a second set of components. */}
          <div
            data-surface="desk"
            // Stamped even when it is the default. The default block is
            // unconditional either way, and an attribute you can read in
            // devtools is worth more than one saved byte.
            data-theme={theme}
            className="bg-background flex h-svh w-full overflow-hidden"
          >
            <SidebarProvider defaultOpen={defaultOpen}>
              <DeskSidebar orgSlug={orgSlug} propertySlug={propertySlug} user={user} />
              {/* `min-w-0` so a wide grid scrolls inside this column rather than
                pushing the whole page sideways. */}
              <SidebarInset className="min-w-0">{children}</SidebarInset>
            </SidebarProvider>
          </div>
        </NiceModalProvider>
      </SurfaceLinksProvider>
    </NextIntlClientProvider>
  );
}
