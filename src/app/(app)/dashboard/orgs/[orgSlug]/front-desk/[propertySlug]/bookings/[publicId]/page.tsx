import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { personDisplayName } from "@/features/directory";
import { isOrgModuleEnabled } from "@/features/organizations";
import { organizationBySlug } from "@/features/organizations/server";
import { BookingCard } from "@/features/reservations/client/components/booking-card";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string; publicId: string }> };

/**
 * One booking, under its own URL.
 *
 * The grid's action bar was the only place a booking could be looked at, and it
 * lived in component state: nothing could be linked to, refreshed or sent to a
 * colleague, and a reservation holding two rooms had no screen at all. Every
 * other first-class object here has a route; this is the one that did not.
 *
 * Addressed by `publicId` rather than the row id — the column exists so a
 * booking can be named outside the building, and a sequential id in a URL would
 * say how many bookings the hotel has taken.
 */
export default async function BookingPage({ params }: Params) {
  const t = await getTranslations("pages");
  const { orgSlug, propertySlug, publicId } = await params;

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

  const property = await prisma.property.findFirst({
    where: { organizationId: organization.id, slug: propertySlug, archivedAt: null },
    select: { id: true, name: true, timezone: true },
  });
  if (!property) {
    notFound();
  }

  // Resolved here as well as in the procedure, so a booking that is not this
  // property's is a 404 rather than an error inside a page that already drew.
  // Two columns only: the card reads the rest for itself and keeps it fresh.
  const booking = await prisma.reservation.findFirst({
    where: { publicId, propertyId: property.id },
    select: {
      reference: true,
      booker: { select: { firstName: true, lastName: true } },
    },
  });
  if (!booking) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={booking.booker ? personDisplayName(booking.booker) : booking.reference}
        description={t("booking.description", { reference: booking.reference })}
        actions={
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href={`/dashboard/orgs/${orgSlug}/front-desk/${propertySlug}`} />}
          >
            {t("booking.backToDesk")}
          </Button>
        }
      />

      <BookingCard
        propertyId={property.id}
        publicId={publicId}
        timezone={property.timezone}
        gridHref={`/dashboard/orgs/${orgSlug}/front-desk/${propertySlug}`}
        directoryHref={`/dashboard/orgs/${orgSlug}/directory`}
      />
    </div>
  );
}
