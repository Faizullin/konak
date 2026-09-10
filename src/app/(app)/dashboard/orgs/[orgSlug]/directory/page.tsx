import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { PeopleTableView } from "@/features/directory/client/components/people-table-view";
import { isOrgModuleEnabled } from "@/features/organizations";
import { organizationBySlug } from "@/features/organizations/server";
import prisma from "@/server/db";

export default async function DirectoryPage({ params }: { params: Promise<{ orgSlug: string }> }) {
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
  if (!isOrgModuleEnabled("DIRECTORY", toggles)) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("directory.title")} description={t("directory.description")} />
      <PeopleTableView organizationId={organization.id} orgSlug={orgSlug} />
    </div>
  );
}
