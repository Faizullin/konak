import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { isOrgModuleEnabled } from "@/features/organizations";
import { organizationBySlug } from "@/features/organizations/server";
import { formatDayMinutes, propertySlugSchema } from "@/features/properties";
import { ReservationGrid } from "@/features/reservations/client/components/reservation-grid";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string }> };

export default async function PropertyGridPage({ params }: Params) {
  const { orgSlug, propertySlug } = await params;
  if (!propertySlugSchema.safeParse(propertySlug).success) {
    notFound();
  }

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

  // The organization is part of the lookup rather than checked after it:
  // another tenant's slug has to be absent here, not forbidden.
  const property = await prisma.property.findFirst({
    where: { organizationId: organization.id, slug: propertySlug, archivedAt: null },
    select: { id: true, name: true, timezone: true, checkInMinutes: true, checkOutMinutes: true },
  });
  if (!property) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={property.name}
        description={`Check-in from ${formatDayMinutes(property.checkInMinutes)}, check-out by ${formatDayMinutes(property.checkOutMinutes)}.`}
      />
      {/* The desk's day, not the browser's: whether a booking has arrived is
          answered in the hotel's timezone. */}
      <ReservationGrid propertyId={property.id} timezone={property.timezone} />
    </div>
  );
}
