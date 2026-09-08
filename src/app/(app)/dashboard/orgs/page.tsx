import { PageHeader } from "@/components/common/page-header";
import { OrganizationList } from "@/features/organizations/client/components/organization-list";

export default function OrganizationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        description="Every organization you belong to, and your role in each."
      />
      <OrganizationList />
    </div>
  );
}
