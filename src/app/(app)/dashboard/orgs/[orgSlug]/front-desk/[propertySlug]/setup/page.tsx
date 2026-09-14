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
import { AttachmentsPanel } from "@/features/platform/client/components/attachments-panel";
import { ChannelsPanel } from "@/features/channels/client/components/channels-panel";
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

      {/* Last of the four, because it depends on all of them: a mapping names
          a room type and a rate plan, and a channel told about neither would
          be told the property is closed. */}
      <ChannelsPanel propertyId={property.id} organizationId={organization.id} />

      {/* The first mount of the shared panel. A property is a valid subject,
          this route is already manager-gated, and photographs of the place are
          what a booking widget will ask for first. */}
      <AttachmentsPanel
        organizationId={organization.id}
        subject={{ propertyId: property.id }}
        kind="FILE"
        title={t("property.filesTitle")}
      />
    </div>
  );
}
