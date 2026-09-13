import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { HousekeepingBoard } from "@/features/housekeeping/client/components/housekeeping-board";
import { isOrgModuleEnabled } from "@/features/organizations";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string }> };

/**
 * The floor's screen.
 *
 * Behind the same module toggle as the desk, because it is the same property's
 * rooms — housekeeping is not a thing a hotel switches on separately from
 * having rooms at all.
 */
export default async function HousekeepingPage({ params }: Params) {
  const t = await getTranslations("pages");
  const { orgSlug, propertySlug } = await params;

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

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("housekeeping.title")}
        description={t("housekeeping.description", { property: property.name })}
        actions={
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href={`/dashboard/orgs/${orgSlug}/front-desk/${propertySlug}`} />}
          >
            {t("housekeeping.backToDesk")}
          </Button>
        }
      />

      <HousekeepingBoard
        propertyId={property.id}
        organizationId={organization.id}
        timezone={property.timezone}
      />
    </div>
  );
}
