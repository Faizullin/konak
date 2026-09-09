import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { isOrgModuleEnabled } from "@/features/organizations";
import { organizationBySlug } from "@/features/organizations/server";
import { propertySlugSchema } from "@/features/properties";
import {
  RoomsPanel,
  RoomTypesPanel,
} from "@/features/properties/client/components/inventory-panels";
import { RatePlansPanel } from "@/features/rates/client/components/rate-plans-panel";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string }> };

export default async function PropertySetupPage({ params }: Params) {
  const t = await getTranslations("pages");
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

  const property = await prisma.property.findFirst({
    where: { organizationId: organization.id, slug: propertySlug, archivedAt: null },
    select: { id: true, name: true, currencyCode: true },
  });
  if (!property) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("property.setupTitle", { property: property.name })}
        description={t("property.setupDescription")}
        actions={
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href={`/dashboard/orgs/${orgSlug}/front-desk/${propertySlug}`} />}
          >
            {t("property.backToDesk")}
          </Button>
        }
      />

      {/* Types before rooms, and both before plans: a room needs a type, and a
          plan is quoted against one. The order on screen is the order a
          property is actually set up in. */}
      <RoomTypesPanel propertyId={property.id} organizationId={organization.id} />
      <RoomsPanel propertyId={property.id} organizationId={organization.id} />
      <RatePlansPanel
        propertyId={property.id}
        organizationId={organization.id}
        currencyCode={property.currencyCode}
      />
    </div>
  );
}
