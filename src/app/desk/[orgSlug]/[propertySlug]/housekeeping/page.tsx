import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { DeskSection } from "@/features/desk/client/components/desk-section";
import { HousekeepingBoard } from "@/features/housekeeping/client/components/housekeeping-board";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string }> };

/**
 * The floor's day.
 *
 * The desk could read a room's state and not change it: the board was on the
 * dashboard only, so the client's fourth item — статус номера — was half here.
 * A room is clean or dirty because of something somebody did, and the person
 * who does it works from this screen.
 *
 * Cards rather than a table, because it is read standing up by somebody moving
 * between floors with one hand free — and every room appears, not only the ones
 * with work owed on them.
 */
export default async function DeskHousekeepingPage({ params }: Params) {
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
      section={t("section.housekeeping")}
      dashboardHref={`/dashboard/orgs/${orgSlug}`}
    >
      <HousekeepingBoard
        propertyId={property.id}
        organizationId={organization.id}
        timezone={property.timezone}
      />
    </DeskSection>
  );
}
