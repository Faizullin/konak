import { PageHeader } from "@/components/common/page-header";
import { UsersTableView } from "@/features/identity/client";

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Everyone with an account on this install, and the role each one holds."
      />
      <UsersTableView />
    </div>
  );
}
