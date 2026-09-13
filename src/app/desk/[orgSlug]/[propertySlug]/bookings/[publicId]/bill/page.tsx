import { notFound } from "next/navigation";
import { FolioPanel } from "@/features/billing/client/components/folio-panel";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string; publicId: string }> };

/**
 * Оплата — the bill.
 *
 * `FolioPanel` whole, unchanged: it is Phase 6's work and already tested, and
 * the point of this surface is a different layout around the same procedures.
 * A departure opens the bill in the transaction that records it, so this is
 * usually a bill that already exists rather than one to create.
 *
 * The reservation's row id is resolved here because the panel bills a
 * reservation, while the URL names one by the id that may be said out loud.
 */
export default async function Page({ params }: Params) {
  const { orgSlug, propertySlug, publicId } = await params;

  const organization = await organizationBySlug(orgSlug);
  if (!organization) notFound();

  const property = await prisma.property.findFirst({
    where: { organizationId: organization.id, slug: propertySlug, archivedAt: null },
    select: { id: true },
  });
  if (!property) notFound();

  const reservation = await prisma.reservation.findFirst({
    where: { publicId, propertyId: property.id },
    select: { id: true },
  });
  if (!reservation) notFound();

  return <FolioPanel propertyId={property.id} reservationId={reservation.id} />;
}
