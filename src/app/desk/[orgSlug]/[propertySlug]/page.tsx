import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { DeskSection } from "@/features/desk/client/components/desk-section";
import { DeskGrid } from "@/features/desk/client/components/desk-grid";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string }> };

/**
 * The шахматка, in two columns.
 *
 * The old screen stacks the day lists *above* the grid in one column, so a
 * receptionist scrolls vertically all day between the two halves of one job.
 * Here they share a screen: the grid takes the width it needs and today sits
 * beside it.
 */
export default async function DeskGridPage({ params }: Params) {
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
      section={t("section.grid")}
      dashboardHref={`/dashboard/orgs/${orgSlug}`}
    >
      <DeskGrid
        propertyId={property.id}
        timezone={property.timezone}
        orgSlug={orgSlug}
        propertySlug={propertySlug}
      />
    </DeskSection>
  );
}
