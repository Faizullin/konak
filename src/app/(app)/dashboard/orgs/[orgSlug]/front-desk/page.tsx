import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { NewPropertyButton } from "@/features/properties/client/components/new-property-button";
import { isOrgModuleEnabled } from "@/features/organizations";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

/**
 * The front desk is a property's screen, and an organization may run several
 * hotels — so this picks one. With a single property there is nothing to pick
 * and it goes straight there.
 */
export default async function FrontDeskPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const t = await getTranslations("pages");
  const { orgSlug } = await params;
  const organization = await organizationBySlug(orgSlug);
  if (!organization) {
    notFound();
  }

  // A module that is off has no page. The procedures refuse it too — this is
  // the courtesy, `requireOrgModule` is the enforcement.
  const toggles = await prisma.organizationModule.findMany({
    where: { organizationId: organization.id },
    select: { moduleId: true, enabled: true },
  });
  if (!isOrgModuleEnabled("FRONT_DESK", toggles)) {
    notFound();
  }

  const properties = await prisma.property.findMany({
    where: { organizationId: organization.id, archivedAt: null },
    orderBy: { name: "asc" },
    select: { name: true, slug: true, timezone: true },
  });

  // No redirect when there is exactly one. It was a kindness — a list of one
  // is a click nobody needs — but it also made this the only screen from which
  // a second property can be added, and skipping it made the second hotel
  // unreachable. One click is the cheaper half of that trade.

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("frontDesk.title")}
        description={t("frontDesk.description")}
        actions={<NewPropertyButton organizationId={organization.id} orgSlug={orgSlug} />}
      />
      {properties.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("frontDesk.empty")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {properties.map((property) => (
            <li key={property.slug}>
              <Link
                href={`/dashboard/orgs/${orgSlug}/front-desk/${property.slug}`}
                className="hover:bg-accent block rounded border px-4 py-3"
              >
                <span className="font-medium">{property.name}</span>
                <span className="text-muted-foreground block text-xs">{property.timezone}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
