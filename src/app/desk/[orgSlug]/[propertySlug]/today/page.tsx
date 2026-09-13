import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { DeskSection } from "@/features/desk/client/components/desk-section";
import { FrontDeskDay } from "@/features/reservations/client/components/front-desk-day";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string }> };

/**
 * Today's work, on its own.
 *
 * It is also the column beside the grid — the same component, because two
 * views of one day that could disagree is exactly the thing the desk cannot
 * afford. A receptionist who wants only today gets the width for it.
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
      section={t("section.today")}
      dashboardHref={`/dashboard/orgs/${orgSlug}`}
    >
      <FrontDeskDay
        propertyId={property.id}
        timezone={property.timezone}
        orgSlug={orgSlug}
        propertySlug={propertySlug}
      />
    </DeskSection>
  );
}
