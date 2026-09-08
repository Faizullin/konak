import { PageHeader } from "@/components/common/page-header";
import { CurrentUserCard } from "@/features/identity/client/components/current-user-card";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Your account and the org you work in." />
      <CurrentUserCard />
    </div>
  );
}
