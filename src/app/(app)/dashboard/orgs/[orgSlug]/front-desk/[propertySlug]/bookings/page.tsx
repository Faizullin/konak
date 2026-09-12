import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { isOrgModuleEnabled } from "@/features/organizations";
import { organizationBySlug } from "@/features/organizations/server";
import { BookingsTableView } from "@/features/reservations/client/components/bookings-table-view";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string }> };

/**
 * Every booking, found without knowing its dates.
 *
 * The grid is bounded by a window, so a guest ringing about next March could
 * not be found at all. Three tabs partition the six states — asked for, sold,
 * over — and each row opens the same card the grid opens.
 */
export default async function BookingsPage({ params }: Params) {
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
    select: { id: true, name: true },
  });
  if (!property) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("bookings.title")}
        description={t("bookings.description", { property: property.name })}
        actions={
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href={`/dashboard/orgs/${orgSlug}/front-desk/${propertySlug}`} />}
          >
            {t("bookings.backToDesk")}
          </Button>
        }
      />

      <BookingsTableView propertyId={property.id} orgSlug={orgSlug} propertySlug={propertySlug} />
    </div>
  );
}
