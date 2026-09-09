import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/common/page-header";
import { CurrentUserCard } from "@/features/identity/client/components/current-user-card";

export default async function DashboardPage() {
  const t = await getTranslations("pages");
  return (
    <div className="space-y-6">
      <PageHeader title={t("overview.title")} description={t("overview.description")} />
      <CurrentUserCard />
    </div>
  );
}
