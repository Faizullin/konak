import { notFound } from "next/navigation";
import { DeskBookingMain } from "@/features/desk/client/components/desk-booking-main";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string; publicId: string }> };

/** Основное — dates, category, tariff, guests, and the status actions. */
export default async function Page({ params }: Params) {
  const { orgSlug, propertySlug, publicId } = await params;

  const organization = await organizationBySlug(orgSlug);
  if (!organization) notFound();

  const property = await prisma.property.findFirst({
    where: { organizationId: organization.id, slug: propertySlug, archivedAt: null },
    select: { id: true, timezone: true },
  });
  if (!property) notFound();

  return (
    <DeskBookingMain
      propertyId={property.id}
      publicId={publicId}
      timezone={property.timezone}
      gridHref={`/desk/${orgSlug}/${propertySlug}`}
      directoryHref={`/dashboard/orgs/${orgSlug}/directory`}
    />
  );
}
