import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { DeskSection } from "@/features/desk/client/components/desk-section";
import {
  RoomTypesPanel,
  RoomsPanel,
} from "@/features/properties/client/components/inventory-panels";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string }> };

/**
 * What the hotel has to sell.\n *\n * Categories above the rooms beneath them, which is the order they are\n * decided in: a room cannot exist without a category, and availability is\n * counted against the category rather than the door.
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
      section={t("section.rooms")}
      dashboardHref={`/dashboard/orgs/${orgSlug}`}
    >
      <div className="space-y-6">
        <RoomTypesPanel propertyId={property.id} organizationId={organization.id} />
        <RoomsPanel propertyId={property.id} organizationId={organization.id} />
      </div>
    </DeskSection>
  );
}
