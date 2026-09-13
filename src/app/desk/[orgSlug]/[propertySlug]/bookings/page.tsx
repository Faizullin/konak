import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { DeskSection } from "@/features/desk/client/components/desk-section";
import { BookingsTableView } from "@/features/reservations/client/components/bookings-table-view";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string }> };

/**
 * Every booking, found without knowing its dates.\n *\n * The grid is bounded by a window; a guest ringing about next March cannot be\n * found on it at all. Three tabs partition the six states, and each row opens\n * the card.
 */
export default async function Page({ params }: Params) {
  const t = await getTranslations("desk");
  const { orgSlug, propertySlug } = await params;

  const organization = await organizationBySlug(orgSlug);
  if (!organization) notFound();

  const property = await prisma.property.findFirst({
    where: { organizationId: organization.id, slug: propertySlug, archivedAt: null },
    select: { id: true, name: true, timezone: true },
  });
  if (!property) notFound();

  return (
    <DeskSection
      property={property.name}
      section={t("section.bookings")}
      dashboardHref={`/dashboard/orgs/${orgSlug}`}
    >
      <BookingsTableView propertyId={property.id} orgSlug={orgSlug} propertySlug={propertySlug} />
    </DeskSection>
  );
}
