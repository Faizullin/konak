import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DeskBar } from "@/features/desk/client/components/desk-bar";
import { DeskBookingTabs } from "@/features/desk/client/components/desk-booking-tabs";
import { personDisplayName } from "@/features/directory";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string; publicId: string }> };

/**
 * The booking's own frame: who it is, then its tabs.
 *
 * A layout rather than a piece of each page, so moving between Основное and
 * Оплата does not redraw the heading — and so the guest's name stays put while
 * the half below it changes, which is what makes them read as tabs at all.
 *
 * Two columns are resolved here and the rest is left to the client, which keeps
 * it fresh: a status changed on the grid must not leave a stale badge here.
 */
export default async function DeskBookingLayout({
  children,
  params,
}: Readonly<{ children: ReactNode } & Params>) {
  const { orgSlug, propertySlug, publicId } = await params;

  const organization = await organizationBySlug(orgSlug);
  if (!organization) notFound();

  const property = await prisma.property.findFirst({
    where: { organizationId: organization.id, slug: propertySlug, archivedAt: null },
    select: { id: true, name: true },
  });
  if (!property) notFound();

  // Resolved here as well as in the procedure, so a booking that is not this
  // property's is a 404 rather than an error inside a page that already drew.
  const booking = await prisma.reservation.findFirst({
    where: { publicId, propertyId: property.id },
    select: { reference: true, booker: { select: { firstName: true, lastName: true } } },
  });
  if (!booking) notFound();

  const base = `/desk/${orgSlug}/${propertySlug}/bookings/${publicId}`;

  return (
    <>
      <DeskBar
        property={property.name}
        section={booking.booker ? personDisplayName(booking.booker) : booking.reference}
        dashboardHref={`/dashboard/orgs/${orgSlug}`}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-4">
          <DeskBookingTabs base={base} />
        </div>
        <div className="p-4">{children}</div>
      </div>
    </>
  );
}
