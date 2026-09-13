import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { DeskSection } from "@/features/desk/client/components/desk-section";
import { PeopleTableView } from "@/features/directory/client/components/people-table-view";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string }> };

/**
 * Who has stayed, and who is coming.
 *
 * The directory is organisation-wide rather than per property — a guest of
 * one hotel in a group is a guest of the group — so this is the same list
 * the dashboard shows, reached from the desk a receptionist already has open.
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
      section={t("section.guests")}
      dashboardHref={`/dashboard/orgs/${orgSlug}`}
    >
      <PeopleTableView organizationId={organization.id} orgSlug={orgSlug} />
    </DeskSection>
  );
}
