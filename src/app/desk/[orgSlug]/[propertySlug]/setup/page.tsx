import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { DeskSection } from "@/features/desk/client/components/desk-section";
import { AttachmentsPanel } from "@/features/platform/client/components/attachments-panel";
import { ChannelsPanel } from "@/features/channels/client/components/channels-panel";
import { RatePlansPanel } from "@/features/rates/client/components/rate-plans-panel";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

type Params = { params: Promise<{ orgSlug: string; propertySlug: string }> };

/**
 * The desk's own setup route — `docs/plans/desk-generation.md` step 4.
 *
 * Not every panel the dashboard's version has: rooms and room types already
 * have a daily-use home at this surface's own `rooms/page.tsx`, and drawing
 * them twice in the same shell would be the duplication the dashboard's
 * version does not have to avoid. What lives here is what a shift does not
 * open — rate plans, channel mappings, photographs.
 *
 * No role check on the page itself, same as the dashboard's version: the nav
 * entry that links here is gated on `canManageProperties`, and every panel's
 * own mutations re-check the role that matters to them regardless of how the
 * page was reached.
 */
export default async function Page({ params }: Params) {
  const t = await getTranslations("desk");
  const { orgSlug, propertySlug } = await params;

  const organization = await organizationBySlug(orgSlug);
  if (!organization) notFound();

  const property = await prisma.property.findFirst({
    where: { organizationId: organization.id, slug: propertySlug, archivedAt: null },
    select: { id: true, name: true, currencyCode: true },
  });
  if (!property) notFound();

  return (
    <DeskSection
      property={property.name}
      section={t("section.setup")}
      dashboardHref={`/dashboard/orgs/${orgSlug}`}
    >
      <div className="space-y-6">
        <RatePlansPanel
          propertyId={property.id}
          organizationId={organization.id}
          currencyCode={property.currencyCode}
        />
        <ChannelsPanel propertyId={property.id} organizationId={organization.id} />
        <AttachmentsPanel
          organizationId={organization.id}
          subject={{ propertyId: property.id }}
          kind="FILE"
          title={t("section.setup")}
        />
      </div>
    </DeskSection>
  );
}
