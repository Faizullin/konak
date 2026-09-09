import Link from "next/link";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { isOrgModuleEnabled } from "@/features/organizations";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

/**
 * The front desk is a property's screen, and an organization may run several
 * hotels — so this picks one. With a single property there is nothing to pick
 * and it goes straight there.
 */
export default async function FrontDeskPage({ params }: { params: Promise<{ orgSlug: string }> }) {
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

  if (properties.length === 1) {
    redirect(`/dashboard/orgs/${orgSlug}/front-desk/${properties[0]!.slug}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Front desk" description="Choose a property to open its grid." />
      {properties.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          This organization has no properties yet. One has to exist before there is a desk to run.
        </p>
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
