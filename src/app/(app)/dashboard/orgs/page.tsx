import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/common/page-header";
import { OrganizationList } from "@/features/organizations/client/components/organization-list";

export default async function OrganizationsPage() {
  const t = await getTranslations("pages");
  return (
    <div className="space-y-6">
      <PageHeader title={t("organizations.title")} description={t("organizations.description")} />
      <OrganizationList />
    </div>
  );
}
