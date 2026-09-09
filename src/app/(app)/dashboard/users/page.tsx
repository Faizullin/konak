import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/common/page-header";
import { UsersTableView } from "@/features/identity/client/components/users-table-view";

export default async function UsersPage() {
  const t = await getTranslations("pages");
  return (
    <div className="space-y-6">
      <PageHeader title={t("users.title")} description={t("users.description")} />
      <UsersTableView />
    </div>
  );
}
